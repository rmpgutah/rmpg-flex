// ============================================================
// RMPG Flex — Spillman Flex Menu Bar
// File | View | Tools | Help — with dropdown menus & submenus
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { printWithLightMaps } from '../utils/mapboxLoader';
import { APP_VERSION } from '../utils/version';
import {
  Radio, FileText, Database, Users, MessageSquare, BarChart3, Map,
  LayoutDashboard, QrCode, ScrollText, Settings, LogOut, Search, Printer,
  Maximize2, Minimize2, Monitor, RefreshCw, Eye, Clock, Phone, AlertTriangle, Plus,
  Download, Upload, Keyboard, Info, Shield, ChevronRight, Zap, Bell, BellOff,
  Volume2, VolumeX, ClipboardList, Activity, Wifi, WifiOff, Globe, Hash, Car,
  FileWarning, Terminal, Briefcase, Scale, Gavel, BookOpen, Microscope,
  CalendarDays, Clipboard, MapPin, Package, UserCheck, FileSearch, PenTool,
  HeartPulse, ShieldAlert, GraduationCap, Server, Palette, Bug, Sparkles, Mic,
  MicOff, Video, ClipboardCheck, Contrast, Droplets, Flame, Leaf, Tv, Brain,
  SlidersHorizontal, AudioLines, Network,
} from 'lucide-react';
import {
  setVoiceAlertsEnabled, getVoiceAlertsEnabled, demoAllVoiceAlerts,
} from '../utils/voiceAlerts';
import {
  setVoiceChannelConfig, setVoiceChannelEnabled, isVoiceChannelEnabled,
  getVoiceChannelConfig,
} from '../utils/voiceChannel';
import { setDetailLevel, getDetailLevel, type NarrativeDetail } from '../utils/narrativeComposer';
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
  onlineCount?: number;
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
  onlineCount = 0,
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

  // ── Quick Timer state ──
  const [timerPromptOpen, setTimerPromptOpen] = useState(false);
  const [timerMinutesInput, setTimerMinutesInput] = useState('15');
  const [timerEndTime, setTimerEndTime] = useState<number | null>(null);
  const [timerRemaining, setTimerRemaining] = useState('');
  const [timerTotalMin, setTimerTotalMin] = useState(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerInputRef = useRef<HTMLInputElement>(null);

  // Timer tick effect
  useEffect(() => {
    if (!timerEndTime) return;
    const tick = () => {
      const ms = timerEndTime - Date.now();
      if (ms <= 0) {
        setTimerRemaining('00:00');
        setTimerEndTime(null);
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
        document.title = 'TIMER DONE - RMPG Flex';
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.value = 800;
            gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.3);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.3 + 0.25);
            osc.start(ctx.currentTime + i * 0.3); osc.stop(ctx.currentTime + i * 0.3 + 0.25);
          }
        } catch { /* audio not available */ }
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('RMPG Flex Timer', { body: `${timerTotalMin} minute timer elapsed`, icon: '/favicon.ico' });
        }
        setTimeout(() => { document.title = 'RMPG Flex'; }, 5000);
        return;
      }
      const totalSec = Math.ceil(ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      setTimerRemaining(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    timerIntervalRef.current = setInterval(tick, 1000);
    return () => { if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); };
  }, [timerEndTime, timerTotalMin]);

  // Auto-focus timer input when modal opens
  useEffect(() => {
    if (timerPromptOpen) {
      setTimeout(() => timerInputRef.current?.select(), 50);
    }
  }, [timerPromptOpen]);

  const startQuickTimer = () => {
    const minutes = parseInt(timerMinutesInput, 10);
    if (isNaN(minutes) || minutes <= 0 || minutes > 999) return;
    setTimerTotalMin(minutes);
    setTimerEndTime(Date.now() + minutes * 60 * 1000);
    setTimerPromptOpen(false);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const cancelQuickTimer = () => {
    setTimerEndTime(null);
    setTimerRemaining('');
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = null;
    document.title = 'RMPG Flex';
  };

  // UI toggle states (persisted in localStorage)
  const [scanLinesEnabled, setScanLinesEnabled] = useState(() => {
    return localStorage.getItem('rmpg-scanlines') !== 'false';
  });
  const [vignetteEnabled, setVignetteEnabled] = useState(() => localStorage.getItem('rmpg-fx-vignette') === 'true');
  const [bloomEnabled, setBloomEnabled] = useState(() => localStorage.getItem('rmpg-fx-bloom') === 'true');
  const [amberTintEnabled, setAmberTintEnabled] = useState(() => localStorage.getItem('rmpg-fx-amber') === 'true');
  const [greenPhosphorEnabled, setGreenPhosphorEnabled] = useState(() => localStorage.getItem('rmpg-fx-green') === 'true');
  const [highContrastEnabled, setHighContrastEnabled] = useState(() => localStorage.getItem('rmpg-fx-highcontrast') === 'true');
  const [noiseEnabled, setNoiseEnabled] = useState(() => localStorage.getItem('rmpg-fx-noise') === 'true');
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
  const [voiceEngine, setVoiceEngine] = useState<'edge-tts' | 'browser'>(() => {
    return (localStorage.getItem('rmpg-voice-engine') as 'edge-tts' | 'browser') || 'edge-tts';
  });
  const [alertMinTier, setAlertMinTier] = useState<'minor' | 'moderate' | 'major'>(() => {
    return (localStorage.getItem('rmpg-alert-min-tier') as 'minor' | 'moderate' | 'major') || 'minor';
  });
  const [aiAssistEnabled, setAiAssistEnabled] = useState(() => {
    return localStorage.getItem('rmpg-ai-assist') !== 'false';
  });
  // Voice Channel settings
  const [vcEnabled, setVcEnabled] = useState(() => isVoiceChannelEnabled());
  const [vcListenMode, setVcListenMode] = useState<'auto' | 'wake' | 'manual'>(() => getVoiceChannelConfig().listenMode);
  const [vcListenDuration, setVcListenDuration] = useState<number>(() => getVoiceChannelConfig().listenDuration);
  const [vcWakeWord, setVcWakeWord] = useState(() => getVoiceChannelConfig().wakeWord);
  const [vcConfirmMode, setVcConfirmMode] = useState<'speak' | 'beep' | 'silent'>(() => getVoiceChannelConfig().confirmMode);
  const [vcDetailLevel, setVcDetailLevel] = useState<NarrativeDetail>(() => getDetailLevel());

  // Advanced Voice Channel settings
  const [stressDetection, setStressDetection] = useState(() => localStorage.getItem('rmpg-voice-stress-detection') !== 'false');
  const [welfareChecks, setWelfareChecks] = useState(() => localStorage.getItem('rmpg-voice-welfare-checks') !== 'false');
  const [proximityAlerts, setProximityAlerts] = useState(() => localStorage.getItem('rmpg-voice-proximity-alerts') !== 'false');
  const [tacticalAssessments, setTacticalAssessments] = useState(() => localStorage.getItem('rmpg-voice-tactical-assessments') !== 'false');
  const [nearestUnitsAuto, setNearestUnitsAuto] = useState(() => localStorage.getItem('rmpg-voice-nearest-units') !== 'false');

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
  // Apply persisted display effects on mount
  useEffect(() => {
    if (vignetteEnabled) document.body.classList.add('fx-vignette');
    if (bloomEnabled) document.body.classList.add('fx-bloom');
    if (amberTintEnabled) document.body.classList.add('fx-amber');
    if (greenPhosphorEnabled) document.body.classList.add('fx-green');
    if (highContrastEnabled) document.body.classList.add('fx-highcontrast');
    if (noiseEnabled) document.body.classList.add('fx-noise');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleScanLines = useCallback(() => {
    const next = !scanLinesEnabled;
    setScanLinesEnabled(next);
    localStorage.setItem('rmpg-scanlines', String(next));
    document.body.classList.toggle('no-scanlines', !next);
  }, [scanLinesEnabled]);

  const toggleVignette = useCallback(() => {
    const next = !vignetteEnabled;
    setVignetteEnabled(next);
    localStorage.setItem('rmpg-fx-vignette', String(next));
    document.body.classList.toggle('fx-vignette', next);
  }, [vignetteEnabled]);

  const toggleBloom = useCallback(() => {
    const next = !bloomEnabled;
    setBloomEnabled(next);
    localStorage.setItem('rmpg-fx-bloom', String(next));
    document.body.classList.toggle('fx-bloom', next);
  }, [bloomEnabled]);

  const toggleNoise = useCallback(() => {
    const next = !noiseEnabled;
    setNoiseEnabled(next);
    localStorage.setItem('rmpg-fx-noise', String(next));
    document.body.classList.toggle('fx-noise', next);
  }, [noiseEnabled]);

  const toggleAmber = useCallback(() => {
    const next = !amberTintEnabled;
    setAmberTintEnabled(next);
    localStorage.setItem('rmpg-fx-amber', String(next));
    document.body.classList.toggle('fx-amber', next);
    if (next) { setGreenPhosphorEnabled(false); localStorage.setItem('rmpg-fx-green', 'false'); document.body.classList.remove('fx-green'); }
  }, [amberTintEnabled]);

  const toggleGreen = useCallback(() => {
    const next = !greenPhosphorEnabled;
    setGreenPhosphorEnabled(next);
    localStorage.setItem('rmpg-fx-green', String(next));
    document.body.classList.toggle('fx-green', next);
    if (next) { setAmberTintEnabled(false); localStorage.setItem('rmpg-fx-amber', 'false'); document.body.classList.remove('fx-amber'); }
  }, [greenPhosphorEnabled]);

  const toggleHighContrast = useCallback(() => {
    const next = !highContrastEnabled;
    setHighContrastEnabled(next);
    localStorage.setItem('rmpg-fx-highcontrast', String(next));
    document.body.classList.toggle('fx-highcontrast', next);
  }, [highContrastEnabled]);

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

  const toggleVoiceEngine = useCallback(() => {
    const next = voiceEngine === 'edge-tts' ? 'browser' : 'edge-tts';
    setVoiceEngine(next);
    localStorage.setItem('rmpg-voice-engine', next);
  }, [voiceEngine]);

  const setAlertTier = useCallback((tier: 'minor' | 'moderate' | 'major') => {
    setAlertMinTier(tier);
    localStorage.setItem('rmpg-alert-min-tier', tier);
  }, []);

  const toggleAiAssist = useCallback(() => {
    const next = !aiAssistEnabled;
    setAiAssistEnabled(next);
    localStorage.setItem('rmpg-ai-assist', String(next));
  }, [aiAssistEnabled]);

  // Voice Channel toggles
  const toggleVcEnabled = useCallback(() => {
    const next = !vcEnabled;
    setVcEnabled(next);
    setVoiceChannelEnabled(next);
  }, [vcEnabled]);

  const cycleVcListenMode = useCallback(() => {
    const modes: Array<'auto' | 'wake' | 'manual'> = ['auto', 'wake', 'manual'];
    const idx = modes.indexOf(vcListenMode);
    const next = modes[(idx + 1) % modes.length];
    setVcListenMode(next);
    setVoiceChannelConfig({ listenMode: next });
  }, [vcListenMode]);

  const cycleVcListenDuration = useCallback(() => {
    const durations = [3000, 5000, 8000, 10000];
    const idx = durations.indexOf(vcListenDuration);
    const next = durations[(idx + 1) % durations.length];
    setVcListenDuration(next);
    setVoiceChannelConfig({ listenDuration: next });
  }, [vcListenDuration]);

  const cycleVcConfirmMode = useCallback(() => {
    const modes: Array<'speak' | 'beep' | 'silent'> = ['speak', 'beep', 'silent'];
    const idx = modes.indexOf(vcConfirmMode);
    const next = modes[(idx + 1) % modes.length];
    setVcConfirmMode(next);
    setVoiceChannelConfig({ confirmMode: next });
  }, [vcConfirmMode]);

  const cycleVcDetailLevel = useCallback(() => {
    const levels: NarrativeDetail[] = ['minimal', 'standard', 'full'];
    const idx = levels.indexOf(vcDetailLevel);
    const next = levels[(idx + 1) % levels.length];
    setVcDetailLevel(next);
    setDetailLevel(next);
  }, [vcDetailLevel]);

  const toggleStressDetection = useCallback(() => {
    const next = !stressDetection;
    setStressDetection(next);
    localStorage.setItem('rmpg-voice-stress-detection', String(next));
  }, [stressDetection]);

  const toggleWelfareChecks = useCallback(() => {
    const next = !welfareChecks;
    setWelfareChecks(next);
    localStorage.setItem('rmpg-voice-welfare-checks', String(next));
  }, [welfareChecks]);

  const toggleProximityAlerts = useCallback(() => {
    const next = !proximityAlerts;
    setProximityAlerts(next);
    localStorage.setItem('rmpg-voice-proximity-alerts', String(next));
  }, [proximityAlerts]);

  const toggleTacticalAssessments = useCallback(() => {
    const next = !tacticalAssessments;
    setTacticalAssessments(next);
    localStorage.setItem('rmpg-voice-tactical-assessments', String(next));
  }, [tacticalAssessments]);

  const toggleNearestUnitsAuto = useCallback(() => {
    const next = !nearestUnitsAuto;
    setNearestUnitsAuto(next);
    localStorage.setItem('rmpg-voice-nearest-units', String(next));
  }, [nearestUnitsAuto]);

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
          { type: 'action', label: 'Service Job', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', label: 'Serve Intake (Drop Documents)', icon: Upload, action: () => navigate('/serve-intake') },
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
          { type: 'action', label: 'Sex Offender Registry', icon: ShieldAlert, action: () => navigate('/sex-offender-registry') },
          { type: 'separator' },
          { type: 'action', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', label: 'Serve Intake', icon: Upload, action: () => navigate('/serve-intake') },
          { type: 'separator' },
          { type: 'action', label: 'Personnel', icon: Users, action: () => navigate('/personnel') },
          { type: 'action', label: 'Fleet', icon: Car, action: () => navigate('/fleet') },
          { type: 'action', label: 'Body Cameras', icon: Video, action: () => navigate('/body-cameras') },
          { type: 'action', label: 'Dash Cameras', icon: Video, action: () => navigate('/dash-cameras') },
          { type: 'action', label: 'Dashcam AI Console', icon: Video, action: () => navigate('/dashcam-ai') },
          { type: 'action', label: 'Shift Plans', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'action', label: 'Dispatch Geography', icon: MapPin, action: () => navigate('/geography') },
          { type: 'separator' },
          { type: 'action', label: 'Communications', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'action', label: 'Radio', icon: Radio, action: () => navigate('/radio') },
          { type: 'action', label: 'Patrol', icon: QrCode, action: () => navigate('/patrol') },
          { type: 'separator' },
          { type: 'action', label: 'Reports', icon: BarChart3, action: () => navigate('/reports') },
          { type: 'action', label: 'Daily Activity', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'action', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'action', label: 'Connections', icon: Network, action: () => navigate('/connections') },
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
      { type: 'action', label: 'Settings / Preferences', icon: SlidersHorizontal, shortcut: 'Ctrl+,', action: () => navigate('/settings') },
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
        icon: Tv,
        items: [
          { type: 'toggle', label: 'CRT Scan Lines', icon: Activity, checked: scanLinesEnabled, action: toggleScanLines },
          { type: 'toggle', label: 'CRT Vignette', icon: Eye, checked: vignetteEnabled, action: toggleVignette },
          { type: 'toggle', label: 'Phosphor Bloom', icon: Sparkles, checked: bloomEnabled, action: toggleBloom },
          { type: 'toggle', label: 'Film Grain', icon: Droplets, checked: noiseEnabled, action: toggleNoise },
          { type: 'separator' },
          { type: 'toggle', label: 'Amber Phosphor', icon: Flame, checked: amberTintEnabled, action: toggleAmber },
          { type: 'toggle', label: 'Green Phosphor', icon: Leaf, checked: greenPhosphorEnabled, action: toggleGreen },
          { type: 'separator' },
          { type: 'toggle', label: 'High Contrast', icon: Contrast, checked: highContrastEnabled, action: toggleHighContrast },
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
          { type: 'separator' },
          { type: 'toggle', label: `Voice Engine: ${voiceEngine === 'edge-tts' ? 'Neural AI' : 'Browser'}`, icon: AudioLines, checked: voiceEngine === 'edge-tts', action: toggleVoiceEngine },
          { type: 'separator' },
          { type: 'action', label: `Alert Level: ${alertMinTier === 'minor' ? 'All Alerts' : alertMinTier === 'moderate' ? 'Important Only' : 'Emergencies Only'}`, icon: SlidersHorizontal, action: () => {
            // Cycle through tiers: minor → moderate → major → minor
            const next = alertMinTier === 'minor' ? 'moderate' : alertMinTier === 'moderate' ? 'major' : 'minor';
            setAlertTier(next);
          }},
          { type: 'separator' },
          { type: 'toggle', label: 'AI Dispatch Assistant', icon: Brain, checked: aiAssistEnabled, action: toggleAiAssist },
        ],
      },
      {
        type: 'submenu',
        label: 'Voice Channel',
        icon: Radio,
        items: [
          { type: 'toggle', label: 'Voice Channel Enabled', icon: vcEnabled ? Mic : MicOff, checked: vcEnabled, action: toggleVcEnabled },
          { type: 'separator' },
          { type: 'action', label: `Listen Mode: ${vcListenMode === 'auto' ? 'Auto' : vcListenMode === 'wake' ? 'Wake Word' : 'Manual Only'}`, icon: AudioLines, action: cycleVcListenMode },
          { type: 'action', label: `Listen Duration: ${vcListenDuration / 1000}s`, icon: Clock, action: cycleVcListenDuration },
          ...(vcListenMode === 'wake' ? [
            { type: 'action' as const, label: `Wake Word: "${vcWakeWord}"`, icon: Mic, action: () => {
              const word = prompt('Enter wake word:', vcWakeWord);
              if (word && word.trim()) {
                setVcWakeWord(word.trim().toLowerCase());
                setVoiceChannelConfig({ wakeWord: word.trim().toLowerCase() });
              }
            }},
          ] : []),
          { type: 'separator' },
          { type: 'action', label: `Confirmation: ${vcConfirmMode === 'speak' ? 'Speak' : vcConfirmMode === 'beep' ? 'Beep Only' : 'Silent'}`, icon: Volume2, action: cycleVcConfirmMode },
          { type: 'action', label: `Alert Detail: ${vcDetailLevel === 'minimal' ? 'Minimal' : vcDetailLevel === 'standard' ? 'Standard' : 'Full Tactical'}`, icon: SlidersHorizontal, action: cycleVcDetailLevel },
          { type: 'separator' },
          { type: 'toggle', label: 'Stress Detection', checked: stressDetection, action: toggleStressDetection },
          { type: 'toggle', label: 'Welfare Checks', checked: welfareChecks, action: toggleWelfareChecks },
          { type: 'toggle', label: 'Proximity Alerts', checked: proximityAlerts, action: toggleProximityAlerts },
          { type: 'toggle', label: 'Tactical Assessments', checked: tacticalAssessments, action: toggleTacticalAssessments },
          { type: 'toggle', label: 'Auto Nearest Units', checked: nearestUnitsAuto, action: toggleNearestUnitsAuto },
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
      { type: 'action', label: timerEndTime ? `Timer: ${timerRemaining}` : 'Quick Timer', icon: Clock, action: () => {
        if (timerEndTime) { cancelQuickTimer(); } else { setTimerPromptOpen(true); }
      }},
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
          { type: 'action', label: 'Geography / Zones', icon: MapPin, action: () => navigate('/geography') },
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
          { type: 'action', label: 'Warrant Check', icon: Gavel, action: () => navigate('/warrants') },
          { type: 'action', label: 'Offender Registry', icon: UserCheck, action: () => navigate('/offender-registry') },
          { type: 'action', label: 'Sex Offender Registry', icon: ShieldAlert, action: () => navigate('/sex-offender-registry') },
          { type: 'separator' },
          { type: 'action', label: 'MicroBilt', icon: Search, action: () => navigate('/microbilt') },
          { type: 'action', label: 'Web Research', icon: Globe, action: () => navigate('/web-research') },
          { type: 'action', label: 'Recon Connect', icon: Search, action: () => navigate('/recon-connect') },
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
          { type: 'action', label: 'Use of Force', icon: AlertTriangle, action: () => navigate('/use-of-force') },
          { type: 'action', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', label: 'Serve Intake Upload', icon: Upload, action: () => navigate('/serve-intake') },
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

        ],
      },
      {
        type: 'submenu',
        label: 'Analysis & Reports',
        icon: BarChart3,
        items: [
          { type: 'action', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'action', label: 'Connections', icon: Network, action: () => navigate('/connections') },
          { type: 'action', label: 'Forensic Lab', icon: Microscope, action: () => navigate('/forensic-lab') },
          { type: 'action', label: 'Statute Analytics', icon: Scale, action: () => navigate('/statute-analytics') },
          { type: 'action', label: 'Custom Report Builder', icon: PenTool, action: () => navigate('/reports/custom') },
          { type: 'separator' },
          { type: 'action', label: 'Reports Dashboard', icon: BarChart3, action: () => navigate('/reports') },
          { type: 'action', label: 'PDF Editor', icon: FileText, action: () => navigate('/pdf-editor') },
          { type: 'action', label: 'Historical GPS Tracks', icon: BarChart3, action: () => navigate('/historical-tracks') },
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
          { type: 'action', label: 'Security Dashboard', icon: Shield, action: () => navigate('/security-dashboard') },
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
          { type: 'separator' },
          {
            type: 'action',
            label: 'Dispatch Guide (PDF)',
            icon: Download,
            action: async () => {
              try {
                // Lazy-import so the jsPDF chunk only loads when a user
                // actually downloads the guide — keeps the login bundle lean.
                const { generateDispatchGuidePdf } = await import('../utils/dispatchGuidePdfGenerator');
                await generateDispatchGuidePdf();
              } catch (err) {
                console.error('[DispatchGuide] Generation failed:', err);
              }
            },
          },
        ],
      },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'System Status',
        icon: isConnected ? Wifi : WifiOff,
        items: [
          { type: 'action', label: `WebSocket: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`, icon: isConnected ? Wifi : WifiOff, disabled: true, action: () => {} },
          { type: 'action', label: `Users Online: ${onlineCount}`, icon: Users, disabled: true, action: () => {} },
          { type: 'action', label: 'Server: RMPG-FLEX-01', icon: Server, disabled: true, action: () => {} },
          { type: 'action', label: `Page: ${currentPage}`, icon: Globe, disabled: true, action: () => {} },
          { type: 'separator' },
          { type: 'action', label: 'Reconnect', icon: RefreshCw, action: () => window.location.reload() },
          { type: 'action', label: 'System Health', icon: HeartPulse, action: () => navigate('/admin'), adminOnly: true },
        ],
      },
      { type: 'separator' },
      {
        type: 'action',
        label: 'Check for Updates…',
        icon: RefreshCw,
        action: () => {
          const electron = (window as any).electron;
          if (electron?.checkForUpdates) {
            // Electron — trigger the in-app updater. The existing
            // UpdateBanner component will surface progress + restart
            // prompts via the 'update-status' IPC stream.
            electron.checkForUpdates();
          } else {
            // Web browser — no auto-updater; open the installer page
            // in a new tab so a Windows user can grab the latest EXE.
            window.open(
              'https://rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.1.exe',
              '_blank',
              'noopener,noreferrer',
            );
          }
        },
      },
      {
        type: 'action',
        label: 'Download Installer (Windows)',
        icon: Download,
        action: () => {
          window.open(
            'https://rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.1.exe',
            '_blank',
            'noopener,noreferrer',
          );
        },
      },
      { type: 'separator' },
      { type: 'action', label: 'Report a Problem', icon: Bug, action: () => navigate('/admin') },
      { type: 'action', label: 'About RMPG Flex', icon: Info, action: () => navigate('/help') },
      { type: 'separator' },
      { type: 'action', label: 'Download Desktop App', icon: Download, action: () => navigate('/downloads') },
      // Version string with monospace for alignment
      { type: 'action', label: `Version ${APP_VERSION}`, icon: Shield, disabled: true, action: () => {} },
    ],
  };

  const menus = [fileMenu, helpMenu];

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
          {/* 20: Submenu parent with highlight when open + smoother chevron rotation */}
          <div className={`menu-item transition-colors duration-150 ${isDisabled ? 'menu-item-disabled' : ''} ${isSubmenuOpen ? 'bg-white/[0.04]' : ''}`}>
            <span className="menu-item-icon">{Icon && <Icon style={{ width: 11, height: 11 }} />}</span>
            <span className="menu-item-label">{item.label}</span>
            <span className="menu-item-arrow"><ChevronRight style={{ width: 10, height: 10, transition: 'transform 0.2s ease', transform: isSubmenuOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} /></span>
          </div>
          {isSubmenuOpen && (
            <div className="menu-dropdown menu-submenu animate-dropdown-appear">
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
          className={`menu-item transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#888888] focus-visible:outline-none ${isDisabled ? 'menu-item-disabled' : ''}`}
          onClick={() => !isDisabled && handleAction(item.action)}
          disabled={isDisabled}
          role="menuitemcheckbox"
          aria-checked={item.checked}
        >
          <span className="menu-item-icon">{Icon && <Icon style={{ width: 11, height: 11 }} />}</span>
          <span className="menu-item-label">{item.label}</span>
          {/* 21: Toggle check with brand color when checked */}
          <span className={`menu-item-check ${item.checked ? 'text-brand-400' : ''}`} style={{ fontWeight: item.checked ? 700 : 400 }}>{item.checked ? '✓' : ''}</span>
          {item.shortcut && <span className="menu-item-shortcut">{item.shortcut}</span>}
        </button>
      );
    }

    // Regular action
    return (
      <button type="button"
        key={`action-${index}`}
        className={`menu-item transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#888888] focus-visible:outline-none ${isDisabled ? 'menu-item-disabled' : ''}`}
        onClick={() => !isDisabled && handleAction(item.action)}
        disabled={isDisabled}
        role="menuitem"
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
              className={`menu-bar-btn transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#888888] focus-visible:outline-none ${openMenu === menu.label ? 'menu-bar-btn-active' : ''}`}
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
              <div className="menu-dropdown menu-dropdown-root animate-dropdown-appear" role="menu" aria-label={`${menu.label} submenu`}>
                {menu.items.map((item, i) => renderMenuItem(item, i))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* ── 10-Codes Reference Modal ── */}
      {show10Codes && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShow10Codes(false)} role="dialog" aria-modal="true" aria-label="10-Codes Quick Reference">
          <div
            className="panel-beveled w-[700px] max-h-[80vh] overflow-hidden flex flex-col animate-dropdown-appear"
            style={{ background: '#0a0a0a' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 23: 10-codes header with top accent and version tag */}
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: '#050505', borderTop: '2px solid #888888' }}>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                10-Codes Quick Reference
                <span className="text-[8px] font-mono text-rmpg-500 bg-rmpg-800 px-1 py-0 border border-rmpg-700">APCO</span>
              </h2>
              <button type="button" onClick={() => setShow10Codes(false)} className="text-rmpg-400 hover:text-white text-xs transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#888888] focus-visible:outline-none px-2 py-0.5 border border-rmpg-600 hover:border-rmpg-500" aria-label="Close 10-codes reference">ESC</button>
            </div>
            <div className="flex-1 overflow-auto p-4 scrollbar-dark">
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
            <div className="p-2 border-t border-rmpg-700 text-center" style={{ background: '#050505' }}>
              <span className="text-[9px] text-rmpg-500">Press <kbd className="px-1 py-0.5 bg-rmpg-800 border border-rmpg-600 text-rmpg-300 rounded-sm text-[8px]">ESC</kbd> to close</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Timer Prompt Modal ── */}
      {timerPromptOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setTimerPromptOpen(false)}>
          <div className="panel-beveled w-[280px] animate-dropdown-appear" style={{ background: '#0a0a0a' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: '#050505', borderTop: '2px solid #888888' }}>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand-400" />Quick Timer
              </h2>
              <button type="button" onClick={() => setTimerPromptOpen(false)} className="text-rmpg-400 hover:text-white text-xs px-2 py-0.5 border border-rmpg-600 hover:border-rmpg-500">ESC</button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block text-xs text-rmpg-300">Duration (minutes)</label>
              <input
                ref={timerInputRef}
                type="number"
                min="1"
                max="999"
                value={timerMinutesInput}
                onChange={(e) => setTimerMinutesInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') startQuickTimer(); }}
                className="w-full bg-surface-sunken border border-rmpg-600 text-white text-sm font-mono px-3 py-2 focus:border-brand-400 focus:outline-none"
              />
              <div className="flex gap-2">
                {[5, 10, 15, 30].map((m) => (
                  <button key={m} type="button" onClick={() => setTimerMinutesInput(String(m))}
                    className="flex-1 text-xs py-1 border border-rmpg-600 text-rmpg-300 hover:text-white hover:border-rmpg-400 transition-colors">
                    {m}m
                  </button>
                ))}
              </div>
              <button type="button" onClick={startQuickTimer}
                className="w-full py-2 text-xs font-bold text-white border border-brand-400 hover:bg-brand-400/10 transition-colors">
                START TIMER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Timer Indicator ── */}
      {timerEndTime && (
        <div className="fixed top-[76px] right-4 z-[9990] flex items-center gap-2 px-3 py-1.5 border border-rmpg-600 animate-dropdown-appear"
          style={{ background: '#0a0a0a', borderTop: '2px solid #d4a017' }}>
          <Clock className="w-3.5 h-3.5 text-brand-400" />
          <span className="font-mono text-sm text-green-400 tabular-nums">{timerRemaining}</span>
          <button type="button" onClick={cancelQuickTimer} className="text-rmpg-400 hover:text-red-400 text-xs ml-1" title="Cancel timer">&times;</button>
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
  infraction: 'bg-gray-900/30 text-gray-400 border-gray-700/30',
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
    level ? level.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Law reference" onClick={onClose}>
      <div
        className="panel-beveled w-[800px] max-h-[85vh] overflow-hidden flex flex-col animate-dropdown-appear"
        style={{ background: '#0a0a0a' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 24: Law reference header with top accent */}
        <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: '#050505', borderTop: '2px solid #888888' }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Scale className="w-4 h-4 text-brand-400" />
            Law Reference — Criminal & Vehicle Code
          </h2>
          <div className="flex items-center gap-2 text-[10px] text-rmpg-500">
            <span>{total} statutes</span>
            <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-white text-xs transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#888888] focus-visible:outline-none" aria-label="Close law reference">ESC</button>
          </div>
        </div>

        {/* State Tabs */}
        <div className="flex border-b border-rmpg-700 overflow-x-auto scrollbar-dark" style={{ background: '#050505' }}>
          {LAW_STATE_CODES.map(st => (
            <button type="button"
              key={st}
              onClick={() => setActiveState(st)}
              className={`flex-shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#888888] focus-visible:outline-none ${
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
                className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#888888] focus-visible:outline-none ${
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
              className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-[#888888]"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto scrollbar-dark">
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
                  className="w-full text-left px-3 py-2 hover:bg-rmpg-700/20 transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#888888] focus-visible:outline-none"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-1 py-0 text-[8px] font-bold uppercase bg-rmpg-700/60 text-rmpg-300 border border-rmpg-600 leading-tight">
                      {s.state}
                    </span>
                    {/* 25: Citation with wider letter spacing for legal readability */}
                    <span className="text-xs font-mono text-brand-400 font-bold" style={{ letterSpacing: '0.03em' }}>{s.citation}</span>
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
        <div className="p-2 border-t border-rmpg-700 flex items-center justify-between" style={{ background: '#050505' }}>
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
