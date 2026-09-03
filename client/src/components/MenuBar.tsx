// ============================================================
// RMPG Flex — Spillman Flex Menu Bar
// File | View | Tools | Help — with dropdown menus & submenus
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { APP_VERSION } from '../utils/version';
import {
  Radio, FileText, Database, Users, MessageSquare, BarChart3, Map,
  LayoutDashboard, QrCode, ScrollText, Settings, LogOut, Search, Printer,
  Maximize2, Minimize2, Monitor, RefreshCw, Eye, Clock, Phone, AlertTriangle, Plus, Minus,
  Download, Upload, Keyboard, Info, Shield, ChevronRight, Zap, Bell, BellOff,
  Volume2, VolumeX, ClipboardList, Activity, Wifi, WifiOff, Globe, Hash, Car,
  FileWarning, Terminal, Briefcase, Scale, Gavel, BookOpen, Microscope,
  CalendarDays, Clipboard, MapPin, Package, UserCheck, FileSearch, PenTool,
  HeartPulse, ShieldAlert, GraduationCap, Server, Palette, Bug, Sparkles, Mic,
  MicOff, Video, ClipboardCheck, Contrast, Droplets, Flame, Leaf, Tv, Brain,
  SlidersHorizontal, AudioLines, Network, CreditCard, DollarSign, Route, Film,
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
import { isFeatureEnabled, useFeatureFlags } from '../utils/featureFlags';
import { createPrefetchIntentController } from '../hooks/useRoutePrefetch';
import { importWithRetry } from '../utils/importWithRetry';

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
  /** In-app route this action navigates to, when it's a plain `navigate('/x')`.
   *  Used to hover/focus-prefetch the destination chunk. Must be a top-level
   *  nav-catalog path (see routeModules.ts) — never derived from user input
   *  or the current location. Omitted for actions that aren't navigation
   *  (window.print, PDF generation, toggles, etc). */
  path?: string;
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

interface MenuInfo {
  type: 'info';
  label: string;
  icon?: React.ElementType;
}

type MenuItem = MenuAction | MenuSeparator | MenuToggle | MenuSubmenu | MenuInfo;

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
  // Forces a re-render once /api/feature-flags resolves — the menu arrays
  // below are plain literals rebuilt on every render (not memoized), so no
  // dependency array needs the tick, but the component itself still needs
  // to re-render for the conditional spreads to reflect a loaded flag.
  useFeatureFlags();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [winInstallerUrl, setWinInstallerUrl] = useState<string | null>(null);

  // Hover/focus-intent gate in front of prefetchRoute (see Finding 1 of the
  // 2026-07-31 load-time fix wave): a fast pointer sweep through the 54-item
  // "Open Module" submenu must NOT fire ~50 real chunk imports. One
  // controller instance per MenuBar mount; every pending timer is cancelled
  // on unmount so nothing fires after the menu (and its `path` closures) is
  // gone.
  const prefetchIntentRef = useRef(createPrefetchIntentController());
  useEffect(() => {
    const controller = prefetchIntentRef.current;
    return () => controller.cancelAll();
  }, []);

  // Resolve the current Windows installer from the API instead of hardcoding a
  // filename. The previous literal — https://rmpgutah.us/downloads/RMPG-Flex-Setup-5.8.1.exe
  // — was wrong twice over: that host is Pages, which returns the SPA shell for
  // /downloads/* with HTTP 200, and the published artifact had moved on to
  // 5.8.6 as a .zip, so the .exe filename no longer existed in the bucket.
  useEffect(() => {
    apiFetch<{ win?: { url: string } }>('/api/downloads/info')
      .then((info) => setWinInstallerUrl(info?.win?.url ?? null))
      .catch(() => setWinInstallerUrl(null));
  }, []);

  // Open the resolved installer, or fall back to the downloads page. Never
  // guess a URL — a guessed /downloads/<name> is precisely what produced the
  // 11 KB HTML "installer" reported from the field.
  const openWindowsInstaller = useCallback(() => {
    if (winInstallerUrl) {
      window.open(winInstallerUrl, '_blank', 'noopener,noreferrer');
    } else {
      navigate('/downloads');
    }
  }, [winInstallerUrl, navigate]);
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

  // Zoom keyboard shortcuts — Ctrl+= / Ctrl+- / Ctrl+0
  // Declared after zoomIn/zoomOut/zoomReset to avoid TDZ in dependency array

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

  // ── App Zoom ──────────────────────────────────────────────────
  const [appZoom, setAppZoom] = useState(() => {
    try { return parseInt(localStorage.getItem('rmpg-app-zoom') || '100', 10); } catch { return 100; }
  });
  useEffect(() => {
    document.body.style.zoom = `${appZoom}%`;
    try { localStorage.setItem('rmpg-app-zoom', String(appZoom)); } catch { /* quota */ }
  }, [appZoom]);
  const zoomIn = useCallback(() => setAppZoom(z => Math.min(200, z + 10)), []);
  const zoomOut = useCallback(() => setAppZoom(z => Math.max(50, z - 10)), []);
  const zoomReset = useCallback(() => setAppZoom(100), []);

  // Zoom keyboard shortcuts — Ctrl+= / Ctrl+- / Ctrl+0
  useEffect(() => {
    const onZoomKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
        else if (e.key === '-') { e.preventDefault(); zoomOut(); }
        else if (e.key === '0') { e.preventDefault(); zoomReset(); }
      }
    };
    window.addEventListener('keydown', onZoomKey);
    return () => window.removeEventListener('keydown', onZoomKey);
  }, [zoomIn, zoomOut, zoomReset]);

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
          { type: 'action', path: '/dispatch', label: 'Call for Service', icon: Phone, shortcut: 'N', action: () => navigate('/dispatch?newCall=1') },
          { type: 'action', path: '/incidents', label: 'Incident Report', icon: FileText, action: () => navigate('/incidents?newIncident=1') },
          { type: 'action', path: '/arrest-records', label: 'Arrest Report', icon: Shield, action: () => navigate('/arrest-records') },
          { type: 'separator' },
          { type: 'action', path: '/field-interviews', label: 'Field Interview', icon: Clipboard, action: () => navigate('/field-interviews') },
          { type: 'action', path: '/citations', label: 'Citation', icon: FileWarning, action: () => navigate('/citations') },
          ...(isFeatureEnabled('/warrants') ? [{ type: 'action' as const, path: '/warrants', label: 'Warrant', icon: Gavel, action: () => navigate('/warrants') }] : []),
          { type: 'action', path: '/trespass-orders', label: 'Trespass Order', icon: ShieldAlert, action: () => navigate('/trespass-orders') },
          { type: 'action', path: '/use-of-force', label: 'Use of Force Report', icon: AlertTriangle, action: () => navigate('/use-of-force') },
          { type: 'separator' },
          { type: 'action', path: '/serve', label: 'Service Job', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', path: '/serve-intake', label: 'Serve Intake (Drop Documents)', icon: Upload, action: () => navigate('/serve-intake') },
          { type: 'separator' },
          { type: 'action', path: '/communications', label: 'BOLO Alert', icon: AlertTriangle, action: () => navigate('/communications') },
          { type: 'action', path: '/communications', label: 'Message', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'separator' },
          { type: 'action', path: '/dar', label: 'Daily Activity Report', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'action', path: '/shift-plans', label: 'Shift Plan', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'action', path: '/scheduler', label: 'Scheduler', icon: CalendarDays, action: () => navigate('/scheduler') },
        ],
      },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Open Module',
        icon: Globe,
        items: [
          { type: 'action', path: '/', label: 'Dashboard', icon: LayoutDashboard, action: () => navigate('/') },
          { type: 'action', path: '/command-center', label: 'Command Center', icon: Map, action: () => navigate('/command-center') },
          { type: 'action', path: '/navigation', label: 'Navigation & Route Planning', icon: Route, action: () => navigate('/navigation') },
          { type: 'action', path: '/dispatch', label: 'Dispatch', icon: Radio, action: () => navigate('/dispatch') },
          { type: 'action', path: '/map', label: 'Map', icon: Map, action: () => navigate('/map') },
          { type: 'action', path: '/mdt', label: 'MDT Terminal', icon: Terminal, action: () => navigate('/mdt') },
          { type: 'separator' },
          { type: 'action', path: '/incidents', label: 'Incidents', icon: FileText, action: () => navigate('/incidents') },
          { type: 'action', path: '/records', label: 'Records', icon: Database, action: () => navigate('/records') },
          { type: 'action', path: '/arrest-records', label: 'Arrest Records', icon: Shield, action: () => navigate('/arrest-records') },
          { type: 'action', path: '/field-interviews', label: 'Field Interviews', icon: Clipboard, action: () => navigate('/field-interviews') },
          ...(isFeatureEnabled('/warrants') ? [{ type: 'action' as const, path: '/warrants', label: 'Warrants', icon: Gavel, action: () => navigate('/warrants') }] : []),
          { type: 'action', path: '/citations', label: 'Citations', icon: FileWarning, action: () => navigate('/citations') },
          ...(isFeatureEnabled('/evidence') ? [{ type: 'action' as const, path: '/evidence', label: 'Evidence & Property', icon: Package, action: () => navigate('/evidence') }] : []),
          { type: 'separator' },
          { type: 'action', path: '/cases', label: 'Case Management', icon: Briefcase, action: () => navigate('/cases') },
          { type: 'action', path: '/criminal-history', label: 'Criminal History', icon: FileSearch, action: () => navigate('/criminal-history') },
          { type: 'action', path: '/nsopw', label: 'Sex Offender Registry (NSOPW)', icon: ShieldAlert, action: () => navigate('/nsopw') },
          { type: 'action', path: '/national-warrant-search', label: 'National Warrant Search', icon: Search, action: () => navigate('/national-warrant-search') },
          { type: 'separator' },
          { type: 'action', path: '/serve', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', path: '/serve-intake', label: 'Serve Intake', icon: Upload, action: () => navigate('/serve-intake') },
          { type: 'action', path: '/use-of-force', label: 'Use of Force', icon: AlertTriangle, action: () => navigate('/use-of-force') },
          { type: 'separator' },
          { type: 'action', path: '/serve', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', path: '/serve-intake', label: 'Serve Intake', icon: Upload, action: () => navigate('/serve-intake') },
          { type: 'separator' },
          { type: 'action', path: '/personnel', label: 'Personnel', icon: Users, action: () => navigate('/personnel') },
          { type: 'action', path: '/hr', label: 'HR Console', icon: ClipboardCheck, action: () => navigate('/hr') },
          ...(isFeatureEnabled('/fleet') ? [{ type: 'action' as const, path: '/fleet', label: 'Fleet', icon: Car, action: () => navigate('/fleet') }] : []),
          { type: 'action', path: '/body-cameras', label: 'Body Cameras', icon: Video, action: () => navigate('/body-cameras') },
          { type: 'action', path: '/dash-cameras', label: 'Dash Cameras', icon: Video, action: () => navigate('/dash-cameras') },
          { type: 'action', path: '/dashcam-ai', label: 'Dashcam AI Console', icon: Video, action: () => navigate('/dashcam-ai') },
          { type: 'action', path: '/flexcam', label: 'Trip Footage (FlexCam)', icon: Film, action: () => navigate('/flexcam') },
          { type: 'action', path: '/training', label: 'Training', icon: GraduationCap, action: () => navigate('/training') },
          { type: 'action', path: '/training-docs', label: 'Training Docs', icon: BookOpen, action: () => navigate('/training-docs') },
          { type: 'separator' },
          { type: 'action', path: '/shift-plans', label: 'Shift Plans', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'action', path: '/geography', label: 'Dispatch Geography', icon: MapPin, action: () => navigate('/geography') },
          { type: 'action', path: '/geo-data-viewer', label: 'Geo Data Viewer', icon: Map, action: () => navigate('/geo-data-viewer') },
          { type: 'separator' },
          { type: 'action', path: '/communications', label: 'Communications', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'action', path: '/dialer-connect', label: 'Dial Connect', icon: Phone, action: () => navigate('/dialer-connect') },
          { type: 'action', path: '/radio', label: 'Radio', icon: Radio, action: () => navigate('/radio') },
          { type: 'action', path: '/email', label: 'Email', icon: MessageSquare, action: () => navigate('/email') },
          ...(isFeatureEnabled('/patrol') ? [{ type: 'action' as const, path: '/patrol', label: 'Patrol', icon: QrCode, action: () => navigate('/patrol') }] : []),
          { type: 'action', path: '/alerts', label: 'Alert Center', icon: Bell, action: () => navigate('/alerts') },
          { type: 'separator' },
          { type: 'action', path: '/reports', label: 'Reports', icon: BarChart3, action: () => navigate('/reports') },
          { type: 'action', path: '/dar', label: 'Daily Activity', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'action', path: '/crime-analysis', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'action', path: '/statute-analytics', label: 'Statute Analytics', icon: Scale, action: () => navigate('/statute-analytics') },
          { type: 'action', path: '/reports/custom', label: 'Report Builder', icon: PenTool, action: () => navigate('/reports/custom') },
          { type: 'action', path: '/connections', label: 'Connections', icon: Network, action: () => navigate('/connections') },
          { type: 'action', path: '/forensic-lab', label: 'Forensic Lab', icon: Microscope, action: () => navigate('/forensic-lab') },
          { type: 'action', path: '/osint', label: 'OSINT Portal', icon: Search, action: () => navigate('/osint') },
          { type: 'separator' },
          { type: 'action', path: '/crm', label: 'Overwatch (CRM)', icon: Briefcase, action: () => navigate('/crm') },
          { type: 'action', path: '/security-dashboard', label: 'Security Dashboard', icon: Shield, action: () => navigate('/security-dashboard') },
          { type: 'action', path: '/jail', label: 'Jail Management', icon: Shield, action: () => navigate('/jail') },
          { type: 'action', path: '/affairs', label: 'Internal Affairs', icon: ShieldAlert, action: () => navigate('/affairs') },
          { type: 'separator' },
          { type: 'action', path: '/audit', label: 'Audit Trail', icon: ScrollText, action: () => navigate('/audit'), adminOnly: true },
          { type: 'action', path: '/admin', label: 'Administration', icon: Settings, action: () => navigate('/admin'), adminOnly: true },
          { type: 'separator' },
          { type: 'action', path: '/settings', label: 'Settings', icon: SlidersHorizontal, action: () => navigate('/settings') },
          { type: 'action', path: '/help', label: 'Help & About', icon: Info, action: () => navigate('/help') },
        ],
      },
      { type: 'separator' },
      { type: 'action', label: 'Export Current View...', icon: Download, shortcut: 'Ctrl+E', action: () => window.print() },
      { type: 'action', label: 'Print Current View...', icon: Printer, shortcut: 'Ctrl+P', action: () => window.print() },
      { type: 'separator' },
      { type: 'action', label: 'Refresh Data', icon: RefreshCw, shortcut: 'F5', action: onRefreshData },
      { type: 'separator' },
      { type: 'action', path: '/settings', label: 'Settings / Preferences', icon: SlidersHorizontal, shortcut: 'Ctrl+,', action: () => navigate('/settings') },
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
          { type: 'action', path: '/', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'Alt+1', action: () => navigate('/') },
          { type: 'action', path: '/dispatch', label: 'Dispatch', icon: Radio, shortcut: 'Alt+2', action: () => navigate('/dispatch') },
          { type: 'action', path: '/map', label: 'Map', icon: Map, shortcut: 'Alt+3', action: () => navigate('/map') },
          { type: 'action', path: '/records', label: 'Records', icon: Database, shortcut: 'Alt+4', action: () => navigate('/records') },
          { type: 'action', path: '/personnel', label: 'Personnel', icon: Users, shortcut: 'Alt+5', action: () => navigate('/personnel') },
          { type: 'action', path: '/communications', label: 'Comms', icon: MessageSquare, shortcut: 'Alt+6', action: () => navigate('/communications') },
          { type: 'action', path: '/reports', label: 'Reports', icon: BarChart3, shortcut: 'Alt+7', action: () => navigate('/reports') },
          { type: 'action', path: '/mdt', label: 'MDT', icon: Terminal, shortcut: 'Alt+8', action: () => navigate('/mdt') },
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
      { type: 'action', path: '/knowledge-base', label: 'Knowledge Base', icon: BookOpen, action: () => navigate('/knowledge-base') },
      { type: 'action', path: '/ncic', label: 'NCIC Query Terminal', icon: Terminal, action: () => navigate('/ncic') },
      { type: 'separator' },
      { type: 'action', label: timerEndTime ? `Timer: ${timerRemaining}` : 'Quick Timer', icon: Clock, action: () => {
        if (timerEndTime) { cancelQuickTimer(); } else { setTimerPromptOpen(true); }
      }},
      { type: 'toggle', label: 'Fullscreen Mode', icon: isFullscreen ? Minimize2 : Maximize2, shortcut: 'F11', checked: isFullscreen, action: toggleFullscreen },
      { type: 'separator' },
      { type: 'action', label: 'Zoom In', icon: Plus, shortcut: 'Ctrl+=', action: zoomIn },
      { type: 'action', label: 'Zoom Out', icon: Minus, shortcut: 'Ctrl+-', action: zoomOut },
      { type: 'action', label: `Reset View — ${appZoom}%`, icon: Monitor, shortcut: 'Ctrl+0', action: zoomReset },
      { type: 'separator' },
      {
        type: 'submenu',
        label: 'Dispatch & Field',
        icon: Radio,
        items: [
          { type: 'action', path: '/dispatch', label: 'New Call for Service', icon: Phone, shortcut: 'N', action: () => navigate('/dispatch?newCall=1') },
          { type: 'action', path: '/dispatch', label: 'Active Calls Board', icon: ClipboardList, action: () => navigate('/dispatch') },
          { type: 'action', path: '/mdt', label: 'MDT Terminal', icon: Terminal, action: () => navigate('/mdt') },
          { type: 'separator' },
          ...(isFeatureEnabled('/patrol') ? [{ type: 'action' as const, path: '/patrol', label: 'Patrol Scanner', icon: QrCode, action: () => navigate('/patrol') }] : []),
          { type: 'action', path: '/shift-plans', label: 'Shift Planning', icon: CalendarDays, action: () => navigate('/shift-plans') },
          { type: 'action', path: '/geography', label: 'Geography / Zones', icon: MapPin, action: () => navigate('/geography') },
          { type: 'action', path: '/dialer-connect', label: 'Dialer Connect', icon: Phone, action: () => navigate('/dialer-connect') },
          { type: 'action', path: '/dar', label: 'Daily Activity Reports', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'separator' },
          { type: 'action', path: '/command-center', label: 'Command Center', icon: Map, action: () => navigate('/command-center') },
        ],
      },
      {
        type: 'submenu',
        label: 'Records & Lookup',
        icon: Database,
        items: [
          { type: 'action', path: '/records', label: 'Person Search', icon: Users, action: () => navigate('/records') },
          { type: 'action', path: '/records', label: 'Vehicle Search', icon: Car, action: () => navigate('/records') },
          { type: 'action', path: '/incidents', label: 'Incident Lookup', icon: FileText, action: () => navigate('/incidents') },
          { type: 'action', path: '/arrest-records', label: 'Arrest Records', icon: Shield, action: () => navigate('/arrest-records') },
          { type: 'separator' },
          { type: 'action', path: '/dl-search', label: 'DL Search', icon: CreditCard, action: () => navigate('/dl-search') },
          { type: 'action', path: '/criminal-history', label: 'Criminal History', icon: FileSearch, action: () => navigate('/criminal-history') },
          ...(isFeatureEnabled('/warrants') ? [{ type: 'action' as const, path: '/warrants', label: 'Warrant Check', icon: Gavel, action: () => navigate('/warrants') }] : []),
          { type: 'action', path: '/nsopw', label: 'Sex Offender Registry (NSOPW)', icon: ShieldAlert, action: () => navigate('/nsopw') },
          { type: 'action', path: '/national-warrant-search', label: 'National Warrant Search', icon: Search, action: () => navigate('/national-warrant-search') },
          { type: 'separator' },
          { type: 'action', path: '/skip-tracer', label: 'Skip Tracer', icon: Search, action: () => navigate('/skip-tracer') },
          { type: 'action', path: '/microbilt', label: 'MicroBilt', icon: Search, action: () => navigate('/microbilt') },
          { type: 'action', path: '/web-research', label: 'Web Research', icon: Globe, action: () => navigate('/web-research') },
          { type: 'action', path: '/recon-connect', label: 'Recon Connect', icon: Search, action: () => navigate('/recon-connect') },
          { type: 'action', path: '/colorado-doc', label: 'Colorado DOC Search', icon: Search, action: () => navigate('/colorado-doc') },
        ],
      },
      {
        type: 'submenu',
        label: 'Enforcement',
        icon: Shield,
        items: [
          ...(isFeatureEnabled('/warrants') ? [{ type: 'action' as const, path: '/warrants', label: 'Warrants', icon: Gavel, action: () => navigate('/warrants') }] : []),
          { type: 'action', path: '/citations', label: 'Citations', icon: FileWarning, action: () => navigate('/citations') },
          { type: 'action', path: '/trespass-orders', label: 'Trespass Orders', icon: ShieldAlert, action: () => navigate('/trespass-orders') },
          { type: 'action', path: '/cases', label: 'Case Management', icon: Briefcase, action: () => navigate('/cases') },
          ...(isFeatureEnabled('/evidence') ? [{ type: 'action' as const, path: '/evidence', label: 'Evidence & Property', icon: Package, action: () => navigate('/evidence') }] : []),
          { type: 'separator' },
          { type: 'action', path: '/code-enforcement', label: 'Code Enforcement', icon: Scale, action: () => navigate('/code-enforcement') },
          { type: 'action', path: '/court', label: 'Court Tracker', icon: Gavel, action: () => navigate('/court') },
          { type: 'action', path: '/court-records', label: 'Court Records', icon: FileText, action: () => navigate('/court-records') },
          { type: 'separator' },
          { type: 'action', path: '/use-of-force', label: 'Use of Force', icon: AlertTriangle, action: () => navigate('/use-of-force') },
          { type: 'action', path: '/serve', label: 'Process Server', icon: Briefcase, action: () => navigate('/serve') },
          { type: 'action', path: '/serve-intake', label: 'Serve Intake Upload', icon: Upload, action: () => navigate('/serve-intake') },
          { type: 'action', path: '/arrest-records', label: 'Arrest Records', icon: Shield, action: () => navigate('/arrest-records') },
        ],
      },
      {
        type: 'submenu',
        label: 'Personnel & Fleet',
        icon: Users,
        items: [
          { type: 'action', path: '/personnel', label: 'Personnel Directory', icon: Users, action: () => navigate('/personnel') },
          { type: 'action', path: '/hr', label: 'HR Console', icon: ClipboardCheck, action: () => navigate('/hr') },
          { type: 'separator' },
          ...(isFeatureEnabled('/fleet') ? [{ type: 'action' as const, path: '/fleet', label: 'Fleet Management', icon: Car, action: () => navigate('/fleet') }] : []),
          { type: 'action', path: '/body-cameras', label: 'Body Cameras', icon: Video, action: () => navigate('/body-cameras') },
          { type: 'action', path: '/dash-cameras', label: 'Dash Cameras', icon: Video, action: () => navigate('/dash-cameras') },
          { type: 'action', path: '/dashcam-ai', label: 'Dashcam AI Console', icon: Video, action: () => navigate('/dashcam-ai') },
          { type: 'action', path: '/flexcam', label: 'Trip Footage (FlexCam)', icon: Film, action: () => navigate('/flexcam') },
          { type: 'separator' },
          { type: 'action', path: '/training', label: 'Training', icon: GraduationCap, action: () => navigate('/training') },
          { type: 'action', path: '/training-docs', label: 'Training Docs', icon: BookOpen, action: () => navigate('/training-docs') },
          { type: 'separator' },
          { type: 'action', path: '/my-id', label: 'My Officer ID', icon: CreditCard, action: () => navigate('/my-id') },
          { type: 'action', path: '/verify-id', label: 'Verify Officer ID', icon: QrCode, action: () => navigate('/verify-id') },
        ],
      },
      {
        type: 'submenu',
        label: 'Navigation & Map',
        icon: Map,
        items: [
          { type: 'action', path: '/map', label: 'Live Map', icon: Map, action: () => navigate('/map') },
          { type: 'action', path: '/navigation', label: 'Navigation & Route Planning', icon: Route, action: () => navigate('/navigation') },
          { type: 'action', path: '/geo-data-viewer', label: 'Geo Data Viewer', icon: MapPin, action: () => navigate('/geo-data-viewer') },
          { type: 'action', path: '/command-center', label: 'Command Center', icon: Map, action: () => navigate('/command-center') },
          { type: 'action', path: '/geography', label: 'Dispatch Geography', icon: MapPin, action: () => navigate('/geography') },
        ],
      },
      {
        type: 'submenu',
        label: 'Communications',
        icon: MessageSquare,
        items: [
          { type: 'action', path: '/communications', label: 'Communications Center', icon: MessageSquare, action: () => navigate('/communications') },
          { type: 'action', path: '/dialer-connect', label: 'Dial Connect', icon: Phone, action: () => navigate('/dialer-connect') },
          { type: 'action', path: '/radio', label: 'Radio Console', icon: Radio, action: () => navigate('/radio') },
          { type: 'action', path: '/email', label: 'Email', icon: MessageSquare, action: () => navigate('/email') },
          { type: 'separator' },
          { type: 'action', path: '/communications', label: 'Issue BOLO', icon: AlertTriangle, action: () => navigate('/communications') },
          { type: 'action', path: '/communications', label: 'View Active BOLOs', icon: Eye, action: () => navigate('/communications') },
          { type: 'separator' },
          { type: 'action', path: '/alerts', label: 'Alert Center', icon: Bell, action: () => navigate('/alerts') },
          { type: 'action', path: '/notifications', label: 'Notifications', icon: Bell, action: () => navigate('/notifications') },
        ],
      },
      {
        type: 'submenu',
        label: 'Analysis & Reports',
        icon: BarChart3,
        items: [
          { type: 'action', path: '/reports', label: 'Reports Dashboard', icon: BarChart3, action: () => navigate('/reports') },
          { type: 'action', path: '/dar', label: 'Daily Activity Reports', icon: Clipboard, action: () => navigate('/dar') },
          { type: 'action', path: '/crime-analysis', label: 'Crime Analysis', icon: Microscope, action: () => navigate('/crime-analysis') },
          { type: 'separator' },
          { type: 'action', path: '/statute-analytics', label: 'Statute Analytics', icon: Scale, action: () => navigate('/statute-analytics') },
          { type: 'action', path: '/reports/custom', label: 'Custom Report Builder', icon: PenTool, action: () => navigate('/reports/custom') },
          { type: 'separator' },
          { type: 'action', path: '/connections', label: 'Connections', icon: Network, action: () => navigate('/connections') },
          { type: 'action', path: '/forensic-lab', label: 'Forensic Lab', icon: Microscope, action: () => navigate('/forensic-lab') },
          { type: 'action', path: '/iped', label: 'IPED Forensics', icon: Microscope, action: () => navigate('/iped') },
        ],
      },
      {
        type: 'submenu',
        label: 'Support Services',
        icon: Shield,
        items: [
          { type: 'action', path: '/jail', label: 'Jail Management', icon: Shield, action: () => navigate('/jail') },
          { type: 'action', path: '/affairs', label: 'Internal Affairs', icon: ShieldAlert, action: () => navigate('/affairs') },
          { type: 'action', path: '/assets', label: 'Asset Management', icon: Package, action: () => navigate('/assets') },
          { type: 'separator' },
          { type: 'action', path: '/tasks', label: 'Task Management', icon: ClipboardList, action: () => navigate('/tasks') },
          { type: 'action', path: '/qa', label: 'QA / Inspections', icon: ClipboardCheck, action: () => navigate('/qa') },
          { type: 'action', path: '/risk', label: 'Risk Management', icon: Shield, action: () => navigate('/risk') },
          { type: 'separator' },
          { type: 'action', path: '/community', label: 'Community Relations', icon: Users, action: () => navigate('/community') },
          { type: 'action', path: '/billing', label: 'Billing & Invoicing', icon: DollarSign, action: () => navigate('/billing') },
        ],
      },
      { type: 'separator' },
      { type: 'action', path: '/crm', label: 'Overwatch (CRM)', icon: Briefcase, action: () => navigate('/crm') },
      { type: 'action', path: '/security-dashboard', label: 'Security Dashboard', icon: Shield, action: () => navigate('/security-dashboard') },
      {
        type: 'submenu',
        label: 'Administration',
        icon: Settings,
        adminOnly: true,
        items: [
          { type: 'action', path: '/admin', label: 'User Management', icon: Users, action: () => navigate('/admin?tab=users') },
          { type: 'action', path: '/admin', label: 'System Configuration', icon: Settings, action: () => navigate('/admin?tab=system') },
          { type: 'action', path: '/admin', label: 'Security Policy', icon: ShieldAlert, action: () => navigate('/admin?tab=settings') },
          { type: 'action', path: '/admin', label: 'Branding & Reports', icon: Palette, action: () => navigate('/admin?tab=settings') },
          { type: 'separator' },
          { type: 'action', path: '/security-dashboard', label: 'Security Dashboard', icon: Shield, action: () => navigate('/security-dashboard') },
          { type: 'action', path: '/audit', label: 'Audit Trail', icon: ScrollText, action: () => navigate('/audit') },
          { type: 'action', path: '/training-mgmt', label: 'Training Management', icon: GraduationCap, action: () => navigate('/training-mgmt') },
          { type: 'action', path: '/hr', label: 'HR Console', icon: ClipboardCheck, action: () => navigate('/hr') },
          { type: 'action', path: '/settings', label: 'Settings', icon: SlidersHorizontal, action: () => navigate('/settings') },
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
          { type: 'action', path: '/admin', label: 'Priority Levels', icon: Zap, action: () => navigate('/admin?tab=system') },
          { type: 'action', path: '/admin', label: 'Disposition Codes', icon: Hash, action: () => navigate('/admin?tab=system') },
          { type: 'action', path: '/admin', label: 'Incident Types', icon: FileText, action: () => navigate('/admin?tab=system') },
          { type: 'separator' },
          { type: 'action', path: '/law-book', label: 'Law Book', icon: Scale, action: () => { navigate('/law-book'); } },
        ],
      },
      {
        type: 'submenu',
        label: 'Training & Docs',
        icon: GraduationCap,
        items: [
          { type: 'action', path: '/training-docs', label: 'Policies & Training Docs', icon: BookOpen, action: () => navigate('/training-docs') },
          { type: 'action', path: '/training', label: 'Training Dashboard', icon: GraduationCap, action: () => navigate('/training') },
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
                const { generateDispatchGuidePdf } = await importWithRetry(() => import('../utils/dispatchGuidePdfGenerator'));
                await generateDispatchGuidePdf();
              } catch (err) {
                console.error('[DispatchGuide] Generation failed:', err);
              }
            },
          },
          {
            // Two-page tear-off card with shortcuts, priorities, statuses,
            // and CAD commands — meant to live taped to the console.
            // Reuses the same generator the Help page exposes, lazy-imported
            // so jsPDF only loads when the menu item is actually clicked.
            type: 'action',
            label: 'Quick Reference Card (PDF)',
            icon: Download,
            action: async () => {
              try {
                const { generateHelpQuickReferencePdfWithDefaults } = await importWithRetry(() => import('../utils/helpQuickReferencePdf'));
                await generateHelpQuickReferencePdfWithDefaults();
              } catch (err) {
                console.error('[QuickReferenceCard] Generation failed:', err);
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
          { type: 'info', label: `WebSocket: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`, icon: isConnected ? Wifi : WifiOff },
          { type: 'info', label: `Users Online: ${onlineCount}`, icon: Users },
          { type: 'info', label: 'Server: RMPG-FLEX-01', icon: Server },
          { type: 'info', label: `Page: ${currentPage}`, icon: Globe },
          { type: 'separator' },
          { type: 'action', label: 'Reconnect', icon: RefreshCw, action: () => window.location.reload() },
          { type: 'action', path: '/admin', label: 'System Health', icon: HeartPulse, action: () => navigate('/admin?tab=health'), adminOnly: true },
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
            // Web browser — no auto-updater; open the current installer in a
            // new tab so a Windows user can grab the latest build.
            openWindowsInstaller();
          }
        },
      },
      {
        type: 'action',
        // Fallback path only (openWindowsInstaller opens an external URL when
        // one resolved from /api/downloads/info; navigates to /downloads only
        // when it didn't). Harmless to prefetch either way — best-effort.
        path: '/downloads',
        label: 'Download Installer (Windows)',
        icon: Download,
        action: openWindowsInstaller,
      },
      { type: 'separator' },
      { type: 'action', path: '/admin', label: 'Report a Problem', icon: Bug, action: () => navigate('/admin?tab=system') },
      { type: 'action', path: '/help', label: 'About RMPG Flex', icon: Info, action: () => navigate('/help') },
      { type: 'separator' },
      { type: 'action', path: '/downloads', label: 'Download Desktop App', icon: Download, action: () => navigate('/downloads') },
      // Version string with monospace for alignment
      { type: 'info', label: `Version ${APP_VERSION}`, icon: Shield },
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
    const isDisabled = 'disabled' in item ? item.disabled : false;

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
          className={`menu-item transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-rmpg-600 focus-visible:outline-none ${isDisabled ? 'menu-item-disabled' : ''}`}
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

    // Info-only row (non-interactive, no onClick / role / disabled)
    if (item.type === 'info') {
      return (
        <div key={`info-${index}`} className="menu-item menu-item-info" aria-disabled="true">
          <span className="menu-item-icon">{Icon && <Icon style={{ width: 11, height: 11 }} />}</span>
          <span className="menu-item-label">{item.label}</span>
        </div>
      );
    }

    // Regular action. `item.path` is only set for plain navigate('/x') actions
    // (see MenuAction.path) — warm that route's chunk on hover/focus so the
    // click resolves from the module cache instead of showing "Loading
    // module". Gated behind a 120ms hover/focus-intent timer (see the
    // prefetchIntentRef controller above) so sweeping past this item doesn't
    // fire a real import(); never wired for a disabled item or one with no
    // path. Best-effort either way: prefetchRoute swallows everything itself.
    const prefetchKey = `action-${index}-${item.path ?? ''}`;
    const canPrefetch = Boolean(item.path) && !isDisabled;
    return (
      <button type="button"
        key={`action-${index}`}
        className={`menu-item transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-rmpg-600 focus-visible:outline-none ${isDisabled ? 'menu-item-disabled' : ''}`}
        onClick={() => !isDisabled && handleAction(item.action)}
        onMouseEnter={canPrefetch ? () => prefetchIntentRef.current.schedule(prefetchKey, item.path) : undefined}
        onMouseLeave={canPrefetch ? () => prefetchIntentRef.current.cancel(prefetchKey) : undefined}
        onFocus={canPrefetch ? () => prefetchIntentRef.current.schedule(prefetchKey, item.path) : undefined}
        onBlur={canPrefetch ? () => prefetchIntentRef.current.cancel(prefetchKey) : undefined}
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
              className={`menu-bar-btn transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-600 focus-visible:outline-none ${openMenu === menu.label ? 'menu-bar-btn-active' : ''}`}
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
            className="panel-beveled w-[700px] max-w-[calc(100vw-1rem)] max-h-[80dvh] overflow-hidden flex flex-col animate-dropdown-appear"
            style={{ background:"var(--surface-sunken)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 23: 10-codes header with top accent and version tag */}
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: 'var(--surface-overlay)', borderTop: "2px solid var(--border-default)" }}>
              <h2 className="text-sm font-bold text-rmpg-100 flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                10-Codes Quick Reference
                <span className="text-[8px] font-mono text-fg-muted bg-rmpg-800 px-1 py-0 border border-rmpg-700">APCO</span>
              </h2>
              <button type="button" onClick={() => setShow10Codes(false)} className="text-fg-muted hover:text-rmpg-100 text-xs transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-rmpg-600 focus-visible:outline-none px-2 py-0.5 border border-rmpg-600 hover:border-rmpg-500" aria-label="Close 10-codes reference">ESC</button>
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
                        <span className="text-rmpg-100 font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-fg-muted">{desc}</span>
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
                        <span className="text-rmpg-100 font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-fg-muted">{desc}</span>
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
                        <span className="text-rmpg-100 font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-fg-muted">{desc}</span>
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
                        <span className="text-rmpg-100 font-mono font-bold w-12 flex-shrink-0">{code}</span>
                        <span className="text-fg-muted">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-2 border-t border-rmpg-700 text-center" style={{ background: 'var(--surface-overlay)' }}>
              <span className="text-[9px] text-fg-muted">Press <kbd className="px-1 py-0.5 bg-rmpg-800 border border-rmpg-600 text-fg-muted rounded-sm text-[8px]">ESC</kbd> to close</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Timer Prompt Modal ── */}
      {timerPromptOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={() => setTimerPromptOpen(false)}>
          <div className="panel-beveled w-[280px] animate-dropdown-appear" style={{ background:"var(--surface-sunken)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-rmpg-600" style={{ background: 'var(--surface-overlay)', borderTop: "2px solid var(--border-default)" }}>
              <h2 className="text-sm font-bold text-rmpg-100 flex items-center gap-2">
                <Clock className="w-4 h-4 text-brand-400" />Quick Timer
              </h2>
              <button type="button" onClick={() => setTimerPromptOpen(false)} className="text-fg-muted hover:text-rmpg-100 text-xs px-2 py-0.5 border border-rmpg-600 hover:border-rmpg-500">ESC</button>
            </div>
            <div className="p-4 space-y-3">
              <label htmlFor="ff-menubar-0" className="block text-xs text-fg-muted">Duration (minutes)</label>
              <input id="ff-menubar-0"
                ref={timerInputRef}
                type="number"
                min="1"
                max="999"
                value={timerMinutesInput}
                onChange={(e) => setTimerMinutesInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') startQuickTimer(); }}
                className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-100 text-sm font-mono px-3 py-2 focus:border-brand-400 focus:outline-none"
              />
              <div className="flex gap-2">
                {[5, 10, 15, 30].map((m) => (
                  <button key={m} type="button" onClick={() => setTimerMinutesInput(String(m))}
                    className="flex-1 text-xs py-1 border border-rmpg-600 text-fg-muted hover:text-rmpg-100 hover:border-rmpg-400 transition-colors">
                    {m}m
                  </button>
                ))}
              </div>
              <button type="button" onClick={startQuickTimer}
                className="w-full py-2 text-xs font-bold text-rmpg-100 border border-brand-400 hover:bg-brand-400/10 transition-colors">
                START TIMER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Floating Timer Indicator ── */}
      {timerEndTime && (
        <div className="fixed top-[76px] right-4 z-[9990] flex items-center gap-2 px-3 py-1.5 border border-rmpg-600 animate-dropdown-appear"
          style={{ background:"var(--surface-sunken)", borderTop: '2px solid var(--field-label-color)' }}>
          <Clock className="w-3.5 h-3.5 text-brand-400" />
          <span className="font-mono text-sm text-green-400 tabular-nums">{timerRemaining}</span>
          <button type="button" onClick={cancelQuickTimer} className="text-fg-muted hover:text-red-400 text-xs ml-1" title="Cancel timer">&times;</button>
        </div>
      )}

    </>
  );
}
