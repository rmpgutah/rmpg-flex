import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Radio, Mic, MicOff, Users, Volume2, VolumeX, AlertCircle, WifiOff, ShieldAlert,
  Search, Download, Phone, PhoneOff, PhoneCall, PhoneIncoming, Play, Square,
  Antenna, Activity, ScanLine, LogOut, Star, Bell, BellOff, Volume1, Pause,
  Send, Bookmark, BookmarkCheck, Filter, X, Clock, BarChart3, TrendingUp,
  Megaphone, Hash, Type, Printer, FileJson, Maximize2, Minimize2, RefreshCw,
  Rewind, FastForward, Save, Repeat, SkipBack, SkipForward, ListMusic,
  Pin, PinOff, Palette, Settings as SettingsIcon, EyeOff, Eye, Copy, Plus,
  ChevronUp, ChevronDown, Headphones, Radio as RadioIcon, StickyNote,
  Moon, ZoomIn, ZoomOut, Trash, MoonStar, AlarmClock,
} from 'lucide-react';
import { useRadio } from '../hooks/useRadio';
import { usePrivateCall } from '../hooks/usePrivateCall';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import { localToday, safeTimeStr } from '../utils/dateUtils';

// ==========================================================================
// RMPG Flex — RadioPage v4 (operator console — 100+ features all-inline)
// ==========================================================================

// ── Reference data ────────────────────────────────────────
const TEN_CODES: { code: string; meaning: string }[] = [
  { code: '10-1', meaning: 'Receiving poorly' }, { code: '10-2', meaning: 'Receiving well' },
  { code: '10-4', meaning: 'Acknowledged' },     { code: '10-6', meaning: 'Busy' },
  { code: '10-7', meaning: 'Out of service' },   { code: '10-8', meaning: 'In service' },
  { code: '10-9', meaning: 'Repeat' },           { code: '10-10', meaning: 'Off duty' },
  { code: '10-13', meaning: 'Weather/road' },    { code: '10-15', meaning: 'Prisoner in custody' },
  { code: '10-19', meaning: 'Return to station' }, { code: '10-20', meaning: 'Location' },
  { code: '10-22', meaning: 'Disregard' },       { code: '10-23', meaning: 'Stand by' },
  { code: '10-25', meaning: 'Meet' },            { code: '10-27', meaning: 'License check' },
  { code: '10-28', meaning: 'Registration' },    { code: '10-29', meaning: 'Wanted check' },
  { code: '10-32', meaning: 'Person w/ weapon' },{ code: '10-33', meaning: 'EMERGENCY' },
  { code: '10-50', meaning: 'Accident' },        { code: '10-76', meaning: 'En route' },
  { code: '10-97', meaning: 'On scene' },        { code: '10-98', meaning: 'Available' },
];

const PHONETIC_NATO: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
  G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet', K: 'Kilo', L: 'Lima',
  M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
  S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray',
  Y: 'Yankee', Z: 'Zulu',
};
const PHONETIC_LAPD: Record<string, string> = {
  A: 'Adam', B: 'Boy', C: 'Charles', D: 'David', E: 'Edward', F: 'Frank',
  G: 'George', H: 'Henry', I: 'Ida', J: 'John', K: 'King', L: 'Lincoln',
  M: 'Mary', N: 'Nora', O: 'Ocean', P: 'Paul', Q: 'Queen', R: 'Robert',
  S: 'Sam', T: 'Tom', U: 'Union', V: 'Victor', W: 'William', X: 'X-ray',
  Y: 'Young', Z: 'Zebra',
};

const STATUS_QUICKSET = [
  { code: '10-8',  label: 'IN SVC',    color: '#22c55e' },
  { code: '10-7',  label: 'OUT SVC',   color: '#ef4444' },
  { code: '10-19', label: 'STATION',   color: '#888888' },
  { code: '10-23', label: 'STAND BY',  color: '#d4a017' },
  { code: '10-76', label: 'EN ROUTE',  color: '#3b82f6' },
  { code: '10-97', label: 'ON SCENE',  color: '#a855f7' },
];

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const NOTIF_SOUNDS: Record<string, { freq: number; type: OscillatorType; dur: number }> = {
  chime: { freq: 880,  type: 'sine',     dur: 0.15 },
  buzz:  { freq: 220,  type: 'sawtooth', dur: 0.10 },
  click: { freq: 1200, type: 'square',   dur: 0.04 },
  blip:  { freq: 1800, type: 'triangle', dur: 0.08 },
};

const THEMES = ['onyx', 'amber', 'nvg', 'contrast'] as const;
type Theme = typeof THEMES[number];
const FONT_SCALES = { sm: 0.9, md: 1.0, lg: 1.1 };
type FontScale = keyof typeof FONT_SCALES;

const DATE_RANGES = [
  { id: 'all',       label: 'ALL' },
  { id: 'today',     label: 'TODAY' },
  { id: 'h24',       label: '24H' },
  { id: 'week',      label: 'WEEK' },
  { id: 'month',     label: 'MONTH' },
];
const DURATION_FILTERS = [
  { id: '0',  label: 'ANY' },
  { id: '5',  label: '>5s' },
  { id: '10', label: '>10s' },
  { id: '30', label: '>30s' },
];

const DEFAULT_PAGE_TEMPLATES = ['STAND BY', 'CODE 4', 'GO AHEAD', 'COPY', 'NEED BACKUP', 'CLEAR'];
const COLOR_LABELS: { id: string; color: string; label: string }[] = [
  { id: 'red',    color: '#ef4444', label: 'PRIORITY' },
  { id: 'amber',  color: '#d4a017', label: 'REVIEW' },
  { id: 'green',  color: '#22c55e', label: 'RESOLVED' },
  { id: 'blue',   color: '#3b82f6', label: 'INFO' },
];

// ── localStorage helpers ──────────────────────────────────
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ok */ } },
  getSet: (k: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } },
  setSet: (k: string, v: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...v])); } catch { /* ok */ } },
  getJSON: <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  setJSON: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ok */ } },
};

// ── Audio beep generator (multi-preset) ───────────────────
function playBeep(preset: string = 'chime', volume: number = 1) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const cfg = NOTIF_SOUNDS[preset] || NOTIF_SOUNDS.chime;
    o.connect(g); g.connect(ctx.destination);
    o.type = cfg.type;
    o.frequency.setValueAtTime(cfg.freq, ctx.currentTime);
    g.gain.setValueAtTime(0.04 * volume, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + cfg.dur);
    o.start(); o.stop(ctx.currentTime + cfg.dur);
    setTimeout(() => ctx.close().catch(() => {}), Math.max(300, cfg.dur * 1000 + 200));
  } catch { /* ignore */ }
}

// ── Theme palettes (CSS-vars on root via inline style) ────
const THEME_VARS: Record<Theme, Record<string, string>> = {
  onyx:     { '--rt-bg': '#0a0a0a', '--rt-panel': '#0d0d0d', '--rt-border': '#1f1f1f', '--rt-accent': '#d4a017', '--rt-text': '#fff',    '--rt-muted': '#888', '--rt-led-on': '#22c55e', '--rt-tx': '#ef4444', '--rt-crt': '#33ff33' },
  amber:    { '--rt-bg': '#0c0700', '--rt-panel': '#100a02', '--rt-border': '#3a2400', '--rt-accent': '#ffae33', '--rt-text': '#ffd9a3', '--rt-muted': '#a06a00', '--rt-led-on': '#ffae33', '--rt-tx': '#ff5050', '--rt-crt': '#ffae33' },
  nvg:      { '--rt-bg': '#000800', '--rt-panel': '#001a00', '--rt-border': '#0a3a0a', '--rt-accent': '#33ff33', '--rt-text': '#bbffbb', '--rt-muted': '#3a8a3a', '--rt-led-on': '#33ff33', '--rt-tx': '#ff3333', '--rt-crt': '#33ff33' },
  contrast: { '--rt-bg': '#000000', '--rt-panel': '#000000', '--rt-border': '#ffffff', '--rt-accent': '#ffff00', '--rt-text': '#ffffff', '--rt-muted': '#cccccc', '--rt-led-on': '#00ff00', '--rt-tx': '#ff0000', '--rt-crt': '#00ff00' },
};

const COMPARE_DATE = (entry: any, range: string): boolean => {
  if (range === 'all') return true;
  const t = Date.parse(entry?.transmitted_at || '');
  if (!t) return false;
  const now = Date.now();
  if (range === 'today')  { const start = new Date(); start.setHours(0,0,0,0); return t >= start.getTime(); }
  if (range === 'h24')    return now - t <= 86400000;
  if (range === 'week')   return now - t <= 7 * 86400000;
  if (range === 'month')  return now - t <= 30 * 86400000;
  return true;
};

// ── Boolean search: supports OR (|), negation (-) ─────────
function matchesSearch(text: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  // OR groups separated by | — within a group, all terms required (AND)
  const orGroups = q.split('|').map(s => s.trim()).filter(Boolean);
  if (orGroups.length === 0) return true;
  return orGroups.some(group => {
    const tokens = group.split(/\s+/).filter(Boolean);
    return tokens.every(tok => {
      if (tok.startsWith('-')) return !t.includes(tok.slice(1));
      return t.includes(tok);
    });
  });
}

export default function RadioPage() {
  const {
    currentChannel, isTransmitting, activeSpeaker, channelUsers, transmissionLog,
    channelBusy, error, micSupported, panicAlert, joinChannel, leaveChannel,
    startTransmit, stopTransmit, sendPage, startScan, stopScan, scanActive,
    incomingPage, dismissPage, isConnected, radioChannels: RADIO_CHANNELS,
  } = useRadio();

  const {
    incomingCall, activeCall, isInCall, isRinging, ringingTarget, callDuration,
    isMuted: callMuted, error: callError, startCall, acceptCall, declineCall,
    endCall, toggleMute,
  } = usePrivateCall();

  const { user } = useAuth();
  const { addToast } = useToast();
  const pttRef = useRef<HTMLButtonElement>(null);
  const spaceHeldRef = useRef(false);

  // ════════ PERSISTED UI STATE ════════
  const [favorites, setFavorites]               = useState<Set<string>>(() => ls.getSet('radio_favorites'));
  const [mutedChans, setMutedChans]             = useState<Set<string>>(() => ls.getSet('radio_muted_channels'));
  const [chanVolumes, setChanVolumes]           = useState<Record<string, number>>(() => ls.getJSON('radio_channel_volumes', {}));
  const [chanNotes, setChanNotes]               = useState<Record<string, string>>(() => ls.getJSON('radio_channel_notes', {}));
  const [monitorOnly, setMonitorOnly]           = useState<Set<string>>(() => ls.getSet('radio_monitor_only'));
  const [recentChans, setRecentChans]           = useState<string[]>(() => ls.getJSON('radio_recent_channels', []));
  const [notifEnabled, setNotifEnabled]         = useState<boolean>(() => ls.get('radio_notif_enabled') === '1');
  const [soundEnabled, setSoundEnabled]         = useState<boolean>(() => ls.get('radio_sound_enabled') !== '0');
  const [notifSound, setNotifSound]             = useState<string>(() => ls.get('radio_notif_sound') || 'chime');
  const [notifVolume, setNotifVolume]           = useState<number>(() => parseInt(ls.get('radio_notif_volume') || '100', 10));
  const [pageSoundEnabled, setPageSoundEnabled] = useState<boolean>(() => ls.get('radio_page_sound') !== '0');
  const [flashOnTx, setFlashOnTx]               = useState<boolean>(() => ls.get('radio_flash_tx') === '1');
  const [keywordAlerts, setKeywordAlerts]       = useState<string[]>(() => ls.getJSON('radio_keyword_alerts', []));
  const [quietStart, setQuietStart]             = useState<string>(() => ls.get('radio_quiet_start') || '');
  const [quietEnd, setQuietEnd]                 = useState<string>(() => ls.get('radio_quiet_end') || '');
  const [perUserNotif, setPerUserNotif]         = useState<Set<string>>(() => ls.getSet('radio_user_notif'));
  const [autoScrollLock, setAutoScrollLock]     = useState<boolean>(false);
  const [markedIds, setMarkedIds]               = useState<Set<string>>(() => ls.getSet('radio_marked_tx'));
  const [pinnedTxId, setPinnedTxId]             = useState<string | null>(() => ls.get('radio_pinned_tx'));
  const [savedSearches, setSavedSearches]       = useState<string[]>(() => ls.getJSON('radio_saved_searches', []));
  const [compactMode, setCompactMode]           = useState<boolean>(() => ls.get('radio_compact') === '1');
  const [time24h, setTime24h]                   = useState<boolean>(() => ls.get('radio_time_24h') !== '0');
  const [showRelative, setShowRelative]         = useState<boolean>(() => ls.get('radio_time_relative') === '1');
  const [silenceAlertMin, setSilenceAlertMin]   = useState<number>(() => parseInt(ls.get('radio_silence_alert') || '0', 10));
  const [currentStatus, setCurrentStatus]       = useState<string | null>(() => ls.get('radio_current_status'));
  const [theme, setTheme]                       = useState<Theme>(() => (ls.get('radio_theme') as Theme) || 'onyx');
  const [fontScale, setFontScale]               = useState<FontScale>(() => (ls.get('radio_font_scale') as FontScale) || 'md');
  const [reduceMotion, setReduceMotion]         = useState<boolean>(() => ls.get('radio_reduce_motion') === '1');
  const [dimMode, setDimMode]                   = useState<boolean>(() => ls.get('radio_dim_mode') === '1');
  const [hideLive, setHideLive]                 = useState<boolean>(() => ls.get('radio_hide_live') === '1');
  const [hideStats, setHideStats]               = useState<boolean>(() => ls.get('radio_hide_stats') === '1');
  const [hideRefs, setHideRefs]                 = useState<boolean>(() => ls.get('radio_hide_refs') === '1');
  const [hideTopUnits, setHideTopUnits]         = useState<boolean>(() => ls.get('radio_hide_top') === '1');
  const [hideMutedChans, setHideMutedChans]     = useState<boolean>(() => ls.get('radio_hide_muted') === '1');
  const [favsOnly, setFavsOnly]                 = useState<boolean>(() => ls.get('radio_favs_only') === '1');
  const [phoneticMode, setPhoneticMode]         = useState<'nato' | 'lapd'>(() => (ls.get('radio_phonetic') as 'nato' | 'lapd') || 'nato');
  const [pttLock, setPttLock]                   = useState<boolean>(() => ls.get('radio_ptt_lock') === '1');
  const [rogerBeep, setRogerBeep]               = useState<boolean>(() => ls.get('radio_roger_beep') === '1');
  const [countdownBeep, setCountdownBeep]       = useState<boolean>(() => ls.get('radio_countdown') === '1');
  const [hangTimeMs, setHangTimeMs]             = useState<number>(() => parseInt(ls.get('radio_hang_time') || '0', 10));
  const [autoPlayNext, setAutoPlayNext]         = useState<boolean>(() => ls.get('radio_autoplay_next') === '1');
  const [loopRecording, setLoopRecording]       = useState<boolean>(() => ls.get('radio_loop_rec') === '1');
  const [pageTemplates, setPageTemplates]       = useState<string[]>(() => ls.getJSON('radio_page_templates', DEFAULT_PAGE_TEMPLATES));
  const [lastSentPage, setLastSentPage]         = useState<{ msg: string; recipient: string } | null>(() => ls.getJSON('radio_last_page', null));
  const [txAnnotations, setTxAnnotations]       = useState<Record<string, string>>(() => ls.getJSON('radio_tx_annotations', {}));
  const [txColorLabels, setTxColorLabels]       = useState<Record<string, string>>(() => ls.getJSON('radio_tx_colors', {}));
  const [scratchpad, setScratchpad]             = useState<string>(() => ls.get('radio_scratchpad') || '');
  const [activeCallNumber, setActiveCallNumber] = useState<string>(() => ls.get('radio_active_call') || '');
  const [pinnedRecordingId, setPinnedRecordingId] = useState<string | null>(() => ls.get('radio_pinned_rec'));
  const [showSettings, setShowSettings]         = useState<boolean>(false);
  const [showScratch, setShowScratch]           = useState<boolean>(() => ls.get('radio_show_scratch') === '1');
  const [showCodes, setShowCodes]               = useState<boolean>(() => ls.get('radio_show_codes') !== '0');
  const [showPhonetic, setShowPhonetic]         = useState<boolean>(() => ls.get('radio_show_phonetic') !== '0');
  const [excludeSelfFilter, setExcludeSelfFilter] = useState<boolean>(false);
  const [hasAudioFilter, setHasAudioFilter]     = useState<boolean>(false);
  const [markedOnlyFilter, setMarkedOnlyFilter] = useState<boolean>(false);
  const [dateRange, setDateRange]               = useState<string>('all');
  const [durationFilter, setDurationFilter]     = useState<string>('0');
  const [colorFilter, setColorFilter]           = useState<string>('');
  const [columnWidth, setColumnWidth]           = useState<'narrow' | 'std' | 'wide'>(() => (ls.get('radio_col_width') as any) || 'std');

  // Persist effects (batched declarations)
  useEffect(() => { ls.setSet('radio_favorites', favorites); }, [favorites]);
  useEffect(() => { ls.setSet('radio_muted_channels', mutedChans); }, [mutedChans]);
  useEffect(() => { ls.setJSON('radio_channel_volumes', chanVolumes); }, [chanVolumes]);
  useEffect(() => { ls.setJSON('radio_channel_notes', chanNotes); }, [chanNotes]);
  useEffect(() => { ls.setSet('radio_monitor_only', monitorOnly); }, [monitorOnly]);
  useEffect(() => { ls.setJSON('radio_recent_channels', recentChans); }, [recentChans]);
  useEffect(() => { ls.set('radio_notif_enabled', notifEnabled ? '1' : '0'); }, [notifEnabled]);
  useEffect(() => { ls.set('radio_sound_enabled', soundEnabled ? '1' : '0'); }, [soundEnabled]);
  useEffect(() => { ls.set('radio_notif_sound', notifSound); }, [notifSound]);
  useEffect(() => { ls.set('radio_notif_volume', String(notifVolume)); }, [notifVolume]);
  useEffect(() => { ls.set('radio_page_sound', pageSoundEnabled ? '1' : '0'); }, [pageSoundEnabled]);
  useEffect(() => { ls.set('radio_flash_tx', flashOnTx ? '1' : '0'); }, [flashOnTx]);
  useEffect(() => { ls.setJSON('radio_keyword_alerts', keywordAlerts); }, [keywordAlerts]);
  useEffect(() => { ls.set('radio_quiet_start', quietStart); }, [quietStart]);
  useEffect(() => { ls.set('radio_quiet_end', quietEnd); }, [quietEnd]);
  useEffect(() => { ls.setSet('radio_user_notif', perUserNotif); }, [perUserNotif]);
  useEffect(() => { ls.setSet('radio_marked_tx', markedIds); }, [markedIds]);
  useEffect(() => { if (pinnedTxId) ls.set('radio_pinned_tx', pinnedTxId); else ls.set('radio_pinned_tx', ''); }, [pinnedTxId]);
  useEffect(() => { ls.setJSON('radio_saved_searches', savedSearches); }, [savedSearches]);
  useEffect(() => { ls.set('radio_compact', compactMode ? '1' : '0'); }, [compactMode]);
  useEffect(() => { ls.set('radio_time_24h', time24h ? '1' : '0'); }, [time24h]);
  useEffect(() => { ls.set('radio_time_relative', showRelative ? '1' : '0'); }, [showRelative]);
  useEffect(() => { ls.set('radio_silence_alert', String(silenceAlertMin)); }, [silenceAlertMin]);
  useEffect(() => { if (currentStatus) ls.set('radio_current_status', currentStatus); }, [currentStatus]);
  useEffect(() => { ls.set('radio_theme', theme); }, [theme]);
  useEffect(() => { ls.set('radio_font_scale', fontScale); }, [fontScale]);
  useEffect(() => { ls.set('radio_reduce_motion', reduceMotion ? '1' : '0'); }, [reduceMotion]);
  useEffect(() => { ls.set('radio_dim_mode', dimMode ? '1' : '0'); }, [dimMode]);
  useEffect(() => { ls.set('radio_hide_live', hideLive ? '1' : '0'); }, [hideLive]);
  useEffect(() => { ls.set('radio_hide_stats', hideStats ? '1' : '0'); }, [hideStats]);
  useEffect(() => { ls.set('radio_hide_refs', hideRefs ? '1' : '0'); }, [hideRefs]);
  useEffect(() => { ls.set('radio_hide_top', hideTopUnits ? '1' : '0'); }, [hideTopUnits]);
  useEffect(() => { ls.set('radio_hide_muted', hideMutedChans ? '1' : '0'); }, [hideMutedChans]);
  useEffect(() => { ls.set('radio_favs_only', favsOnly ? '1' : '0'); }, [favsOnly]);
  useEffect(() => { ls.set('radio_phonetic', phoneticMode); }, [phoneticMode]);
  useEffect(() => { ls.set('radio_ptt_lock', pttLock ? '1' : '0'); }, [pttLock]);
  useEffect(() => { ls.set('radio_roger_beep', rogerBeep ? '1' : '0'); }, [rogerBeep]);
  useEffect(() => { ls.set('radio_countdown', countdownBeep ? '1' : '0'); }, [countdownBeep]);
  useEffect(() => { ls.set('radio_hang_time', String(hangTimeMs)); }, [hangTimeMs]);
  useEffect(() => { ls.set('radio_autoplay_next', autoPlayNext ? '1' : '0'); }, [autoPlayNext]);
  useEffect(() => { ls.set('radio_loop_rec', loopRecording ? '1' : '0'); }, [loopRecording]);
  useEffect(() => { ls.setJSON('radio_page_templates', pageTemplates); }, [pageTemplates]);
  useEffect(() => { ls.setJSON('radio_last_page', lastSentPage); }, [lastSentPage]);
  useEffect(() => { ls.setJSON('radio_tx_annotations', txAnnotations); }, [txAnnotations]);
  useEffect(() => { ls.setJSON('radio_tx_colors', txColorLabels); }, [txColorLabels]);
  useEffect(() => { ls.set('radio_scratchpad', scratchpad); }, [scratchpad]);
  useEffect(() => { ls.set('radio_active_call', activeCallNumber); }, [activeCallNumber]);
  useEffect(() => { if (pinnedRecordingId) ls.set('radio_pinned_rec', pinnedRecordingId); else ls.set('radio_pinned_rec', ''); }, [pinnedRecordingId]);
  useEffect(() => { ls.set('radio_show_scratch', showScratch ? '1' : '0'); }, [showScratch]);
  useEffect(() => { ls.set('radio_show_codes', showCodes ? '1' : '0'); }, [showCodes]);
  useEffect(() => { ls.set('radio_show_phonetic', showPhonetic ? '1' : '0'); }, [showPhonetic]);
  useEffect(() => { ls.set('radio_col_width', columnWidth); }, [columnWidth]);

  // ════════ EPHEMERAL STATE ════════
  const [pageMessage, setPageMessage] = useState('');
  const [pageRecipient, setPageRecipient] = useState('');
  const [phoneticInput, setPhoneticInput] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [filterUserId, setFilterUserId] = useState<number | null>(null);
  const [txTimer, setTxTimer] = useState(0);
  const [chanSearch, setChanSearch] = useState('');
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState<number>(-1);
  const [newTemplateText, setNewTemplateText] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [annotatingId, setAnnotatingId] = useState<string | null>(null);
  const [annotateText, setAnnotateText] = useState('');
  const [flashCount, setFlashCount] = useState(0);
  const [clockTick, setClockTick] = useState(0);

  // Real-time clock
  useEffect(() => {
    const t = setInterval(() => setClockTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Recent channels: track last 5 ─────────────────
  useEffect(() => {
    if (!currentChannel) return;
    setRecentChans(prev => {
      const next = [currentChannel, ...prev.filter(c => c !== currentChannel)].slice(0, 5);
      return next;
    });
  }, [currentChannel]);

  // ── Quiet hours predicate ─────────────────────────
  const isQuietHour = useMemo(() => {
    if (!quietStart || !quietEnd) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = quietStart.split(':').map(Number);
    const [eh, em] = quietEnd.split(':').map(Number);
    if (Number.isNaN(sh) || Number.isNaN(eh)) return false;
    const start = sh * 60 + (sm || 0);
    const end = eh * 60 + (em || 0);
    return start < end ? cur >= start && cur < end : cur >= start || cur < end;
  }, [quietStart, quietEnd, clockTick]);

  // ── Sorted/filtered channel list ──────────────────
  const sortedChannels = useMemo(() => {
    let list = [...RADIO_CHANNELS];
    if (favsOnly) list = list.filter(c => favorites.has(c.id));
    if (hideMutedChans) list = list.filter(c => !mutedChans.has(c.id));
    if (chanSearch.trim()) {
      const q = chanSearch.toLowerCase();
      list = list.filter(c => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.freq.includes(q));
    }
    return list.sort((a, b) => {
      const aFav = favorites.has(a.id) ? 1 : 0;
      const bFav = favorites.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return 0;
    });
  }, [RADIO_CHANNELS, favorites, favsOnly, hideMutedChans, mutedChans, chanSearch]);

  // ── Channel ops ───────────────────────────────────
  const toggleFavorite = (id: string) => setFavorites(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleMuteChan = (id: string) => setMutedChans(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleMonitorOnly = (id: string) => setMonitorOnly(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setChanVolume = (id: string, v: number) => setChanVolumes(p => ({ ...p, [id]: v }));
  const setChanNote = (id: string, v: string) => setChanNotes(p => ({ ...p, [id]: v }));

  // ── PTT wrapped (with countdown + hang time + roger beep + lock) ──
  const startTransmitWrapped = useCallback(async () => {
    if (currentChannel && monitorOnly.has(currentChannel)) {
      addToast('Monitor-only mode — PTT disabled for this channel', 'info');
      return;
    }
    if (countdownBeep) {
      playBeep('blip', notifVolume / 100);
      await new Promise(r => setTimeout(r, 120));
    }
    startTransmit();
  }, [currentChannel, monitorOnly, countdownBeep, notifVolume, startTransmit, addToast]);

  const stopTransmitWrapped = useCallback(() => {
    const finish = () => {
      stopTransmit();
      if (rogerBeep) setTimeout(() => playBeep('blip', notifVolume / 100), 80);
    };
    if (hangTimeMs > 0) setTimeout(finish, hangTimeMs);
    else finish();
  }, [stopTransmit, rogerBeep, hangTimeMs, notifVolume]);

  // ── Keyboard PTT + global shortcuts ───────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isInput) return;
      if (isInCall) return;

      // Number keys 1-9 → join nth visible channel
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < sortedChannels.length) {
          e.preventDefault();
          joinChannel(sortedChannels[idx].id);
          return;
        }
      }

      // PTT (skip if PTT-lock mode is on — uses click instead)
      if (currentChannel && !pttLock && (e.code === 'Space' || e.key === 'F5' || e.keyCode === 279) && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        startTransmitWrapped();
        return;
      }
      if (currentChannel && pttLock && (e.code === 'Space' || e.keyCode === 279)) {
        e.preventDefault();
        if (isTransmitting) stopTransmitWrapped(); else startTransmitWrapped();
        return;
      }

      // Other shortcuts
      if (e.key === 'm') setSoundEnabled(s => !s);
      if (e.key === 'c') setCompactMode(s => !s);
      if (e.key === 'l') setAutoScrollLock(s => !s);
      if (e.key === 's' && currentChannel) {
        if (scanActive) stopScan();
        else startScan(RADIO_CHANNELS.filter(c => c.id !== currentChannel).map(c => c.id));
      }
      if (e.key === 'j') setSelectedHistoryIdx(i => Math.min(i + 1, 999));
      if (e.key === 'k') setSelectedHistoryIdx(i => Math.max(i - 1, 0));
      if (e.key === 'r') setReduceMotion(v => !v);
      if (e.key === 'd') setDimMode(v => !v);
      if (e.key === 't') setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!pttLock && (e.code === 'Space' || e.key === 'F5' || e.keyCode === 279) && spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = false;
        stopTransmitWrapped();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentChannel, sortedChannels, joinChannel, startTransmitWrapped, stopTransmitWrapped, isInCall, scanActive, startScan, stopScan, RADIO_CHANNELS, pttLock, isTransmitting]);

  // TX timer
  useEffect(() => {
    if (!isTransmitting) { setTxTimer(0); return; }
    const start = Date.now();
    const t = setInterval(() => setTxTimer(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(t);
  }, [isTransmitting]);

  const channelInfo = RADIO_CHANNELS.find(c => c.id === currentChannel);
  const otherSpeaking = activeSpeaker && activeSpeaker.userId !== Number(user?.id);

  // ════════ HISTORY FETCH ════════
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyChannel, setHistoryChannel] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ limit: '300' });
      if (historyChannel) params.set('channel', historyChannel);
      const result = await apiFetch<{ data: any[]; total: number }>(`/comms/radio/transcripts?${params.toString()}`);
      setHistoryEntries(result.data || []);
    } catch { setHistoryEntries([]); }
    finally { setHistoryLoading(false); }
  }, [historyChannel]);

  useLiveSync('dispatch', fetchHistory);
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Filtered history (date / duration / has-audio / marked / exclude-self / search / user / color) ──
  const filteredHistory = useMemo(() => {
    const meId = Number(user?.id);
    const minDur = parseInt(durationFilter, 10);
    return historyEntries.filter(e => {
      if (filterUserId && Number(e.user_id) !== filterUserId) return false;
      if (excludeSelfFilter && Number(e.user_id) === meId) return false;
      if (hasAudioFilter && !e.audio_file) return false;
      if (markedOnlyFilter && !markedIds.has(String(e.id))) return false;
      if (colorFilter && txColorLabels[String(e.id)] !== colorFilter) return false;
      if (minDur > 0 && (Number(e.duration) || 0) < minDur) return false;
      if (!COMPARE_DATE(e, dateRange)) return false;
      if (historySearch && !matchesSearch(e.transcript || '', historySearch) && !matchesSearch(e.full_name || e.username || '', historySearch)) return false;
      return true;
    });
  }, [historyEntries, filterUserId, user, excludeSelfFilter, hasAudioFilter, markedOnlyFilter, markedIds, colorFilter, txColorLabels, durationFilter, dateRange, historySearch]);

  // ── Stats today ──
  const stats = useMemo(() => {
    const today = localToday();
    const meId = Number(user?.id);
    const todayEntries = historyEntries.filter(e => (e.transmitted_at || '').startsWith(today));
    const myToday = todayEntries.filter(e => Number(e.user_id) === meId);
    const myAirSec = myToday.reduce((s, e) => s + (Number(e.duration) || 0), 0);
    const allAirSec = todayEntries.reduce((s, e) => s + (Number(e.duration) || 0), 0);
    const byUser = new Map<string, { name: string; count: number; sec: number }>();
    todayEntries.forEach(e => {
      const k = String(e.user_id || e.username || 'x');
      const cur = byUser.get(k) || { name: e.full_name || e.username || 'Unknown', count: 0, sec: 0 };
      cur.count += 1; cur.sec += Number(e.duration) || 0;
      byUser.set(k, cur);
    });
    const top = [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, 5);
    const byChan = new Map<string, number>();
    todayEntries.forEach(e => byChan.set(e.channel, (byChan.get(e.channel) || 0) + 1));
    const hourly = new Array(24).fill(0);
    todayEntries.forEach(e => {
      try { const h = new Date(e.transmitted_at).getHours(); if (h >= 0 && h < 24) hourly[h] += 1; } catch { /* ignore */ }
    });
    return { myTxCount: myToday.length, myAirSec, allTxCount: todayEntries.length, allAirSec, top, byChan, hourly };
  }, [historyEntries, user]);

  // ── Last-active per channel (most recent transmitted_at) ──
  const lastActivePerChannel = useMemo(() => {
    const m = new Map<string, number>();
    historyEntries.forEach(e => {
      const t = Date.parse(e.transmitted_at || '');
      if (!t) return;
      const cur = m.get(e.channel) || 0;
      if (t > cur) m.set(e.channel, t);
    });
    return m;
  }, [historyEntries]);

  // ════════ AUDIO PLAYBACK ════════
  const [playingId, setPlayingId] = useState<string | number | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [playbackVolume, setPlaybackVolume] = useState<number>(() => parseInt(ls.get('radio_playback_volume') || '100', 10));
  useEffect(() => { ls.set('radio_playback_volume', String(playbackVolume)); }, [playbackVolume]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackStartCtxTimeRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const playbackBufferRef = useRef<AudioBuffer | null>(null);
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackRateRef = useRef(1);

  const stopPlaybackInternal = useCallback(() => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* ok */ }
      try { audioSourceRef.current.disconnect(); } catch { /* ok */ }
      audioSourceRef.current = null;
    }
    if (playbackTimerRef.current) { clearInterval(playbackTimerRef.current); playbackTimerRef.current = null; }
    setPlayingId(null);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    playbackOffsetRef.current = 0;
    playbackBufferRef.current = null;
  }, []);

  const startPlaybackAt = useCallback((buffer: AudioBuffer, offset: number, speed: number, entryId: any, knownDur: number, doLoop: boolean) => {
    const ctx = audioCtxRef.current!;
    if (audioSourceRef.current) {
      const old = audioSourceRef.current;
      old.onended = null;
      try { old.stop(); } catch { /* ok */ }
      try { old.disconnect(); } catch { /* ok */ }
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    source.loop = doLoop;
    if (!gainNodeRef.current) {
      gainNodeRef.current = ctx.createGain();
      gainNodeRef.current.connect(ctx.destination);
    }
    gainNodeRef.current.gain.value = playbackVolume / 100;
    source.connect(gainNodeRef.current);
    source.onended = () => {
      if (audioSourceRef.current !== source) return;
      if (autoPlayNext) {
        const idx = filteredHistory.findIndex(h => String(h.id) === String(entryId));
        const next = filteredHistory.slice(idx + 1).find(h => h.audio_file);
        if (next) { togglePlaybackRef.current && togglePlaybackRef.current(next); return; }
      }
      stopPlaybackInternal();
    };
    source.start(0, offset);
    audioSourceRef.current = source;
    playbackBufferRef.current = buffer;
    playbackOffsetRef.current = offset;
    playbackStartCtxTimeRef.current = ctx.currentTime;
    playbackRateRef.current = speed;
    setPlaybackTime(offset);
    setPlaybackDuration(buffer.duration || knownDur);
    setPlayingId(entryId);
    if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    playbackTimerRef.current = setInterval(() => {
      const elapsed = (ctx.currentTime - playbackStartCtxTimeRef.current) * playbackRateRef.current + playbackOffsetRef.current;
      setPlaybackTime(Math.min(elapsed, buffer.duration));
    }, 100);
  }, [stopPlaybackInternal, autoPlayNext, filteredHistory, playbackVolume]);

  // Update gain when playbackVolume changes
  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = playbackVolume / 100;
  }, [playbackVolume]);

  const togglePlaybackRef = useRef<((entry: any) => void) | null>(null);
  const togglePlayback = useCallback(async (entry: any) => {
    const entryId = entry?.id ?? entry;
    if (playingId === entryId) { stopPlaybackInternal(); return; }
    stopPlaybackInternal();
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContext();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume().catch(() => {});
    try {
      const rawBlob = await apiFetchBlob(`/comms/radio/audio/${entryId}`);
      const arrayBuffer = await rawBlob.arrayBuffer();
      const ctx = audioCtxRef.current!;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const serverDur = typeof entry?.duration === 'number' && entry.duration > 0 ? entry.duration : audioBuffer.duration;
      startPlaybackAt(audioBuffer, 0, playbackSpeed, entryId, serverDur, loopRecording);
    } catch (err: any) {
      addToast(`Playback failed: ${(err?.message || 'Error').slice(0, 100)}`, 'error');
      stopPlaybackInternal();
    }
  }, [playingId, addToast, stopPlaybackInternal, startPlaybackAt, playbackSpeed, loopRecording]);
  togglePlaybackRef.current = togglePlayback;

  const seekPlayback = useCallback((seconds: number) => {
    const buffer = playbackBufferRef.current;
    if (!audioCtxRef.current || !buffer || playingId == null) return;
    const clamped = Math.max(0, Math.min(seconds, buffer.duration));
    startPlaybackAt(buffer, clamped, playbackRateRef.current, playingId, buffer.duration, loopRecording);
  }, [playingId, startPlaybackAt, loopRecording]);

  const changeSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    const buffer = playbackBufferRef.current;
    if (!audioCtxRef.current || !buffer || playingId == null) return;
    const elapsed = (audioCtxRef.current.currentTime - playbackStartCtxTimeRef.current) * playbackRateRef.current + playbackOffsetRef.current;
    startPlaybackAt(buffer, Math.min(elapsed, buffer.duration), speed, playingId, buffer.duration, loopRecording);
  }, [playingId, startPlaybackAt, loopRecording]);

  // Skip prev/next playable recording
  const skipRecording = useCallback((dir: 1 | -1) => {
    const playable = filteredHistory.filter(h => h.audio_file);
    if (playable.length === 0) return;
    const idx = playable.findIndex(h => String(h.id) === String(playingId));
    const nextIdx = idx === -1 ? 0 : (idx + dir + playable.length) % playable.length;
    togglePlayback(playable[nextIdx]);
  }, [filteredHistory, playingId, togglePlayback]);

  const downloadRecording = useCallback(async (entry: any) => {
    try {
      const rawBlob = await apiFetchBlob(`/comms/radio/audio/${entry.id}`);
      const blob = rawBlob.type.startsWith('audio/') ? rawBlob : new Blob([rawBlob], { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const ts = (entry.transmitted_at || '').replace(/[:\s]/g, '-');
      const who = (entry.username || 'unit').replace(/[^a-z0-9_-]/gi, '');
      const chan = (entry.channel || 'radio').replace(/[^a-z0-9_-]/gi, '');
      const a = document.createElement('a');
      a.href = url; a.download = `radio-${chan}-${who}-${ts}.webm`;
      a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { addToast('Failed to download recording', 'error'); }
  }, [addToast]);

  const copyAudioLink = (entry: any) => {
    const url = `${window.location.origin}/api/comms/radio/audio/${entry.id}`;
    navigator.clipboard?.writeText(url).then(
      () => addToast('Audio link copied', 'success'),
      () => addToast('Copy failed', 'error'),
    );
  };

  useEffect(() => () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* ok */ }
      try { audioSourceRef.current.disconnect(); } catch { /* ok */ }
    }
    if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') audioCtxRef.current.close().catch(() => {});
  }, []);

  // ════════ NOTIFICATIONS / SOUND / KEYWORD ALERTS ════════
  const lastNotifIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (transmissionLog.length === 0) return;
    const latest = transmissionLog[transmissionLog.length - 1];
    if (latest.id === lastNotifIdRef.current) return;
    if (Number(latest.userId) === Number(user?.id)) { lastNotifIdRef.current = latest.id; return; }
    lastNotifIdRef.current = latest.id;
    if (mutedChans.has(latest.channel)) return;
    if (isQuietHour) return;

    if (flashOnTx) setFlashCount(c => c + 1);

    const userIdStr = String(latest.userId);
    const userScoped = perUserNotif.size > 0 && !perUserNotif.has(userIdStr);
    if (userScoped) return;

    const transcript = (latest.transcript || '').toLowerCase();
    const keywordHit = keywordAlerts.find(k => k && transcript.includes(k.toLowerCase()));

    if (soundEnabled) playBeep(notifSound, notifVolume / 100);
    if (notifEnabled && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`${keywordHit ? '⚠ ' : ''}Radio: ${latest.fullName || latest.username}`, {
          body: `${latest.channel.toUpperCase()}${latest.transcript ? ' — ' + latest.transcript.slice(0, 80) : ''}${keywordHit ? '\nKeyword: ' + keywordHit : ''}`,
          tag: 'rmpg-radio',
        });
      } catch { /* ok */ }
    }
    if (keywordHit) addToast(`Keyword "${keywordHit}" detected — ${latest.fullName || latest.username}`, 'info');
  }, [transmissionLog, soundEnabled, notifEnabled, mutedChans, user, notifSound, notifVolume, isQuietHour, flashOnTx, perUserNotif, keywordAlerts, addToast]);

  // Page sound
  useEffect(() => {
    if (incomingPage && pageSoundEnabled && !isQuietHour) playBeep('chime', notifVolume / 100);
  }, [incomingPage, pageSoundEnabled, notifVolume, isQuietHour]);

  // Flash overlay decay
  useEffect(() => {
    if (flashCount === 0) return;
    const t = setTimeout(() => setFlashCount(0), 350);
    return () => clearTimeout(t);
  }, [flashCount]);

  const enableNotifications = async () => {
    if (!('Notification' in window)) { addToast('Notifications not supported', 'error'); return; }
    if (Notification.permission === 'granted') { setNotifEnabled(v => !v); return; }
    const p = await Notification.requestPermission();
    setNotifEnabled(p === 'granted');
  };

  // Silence alert
  const lastTrafficRef = useRef<number>(Date.now());
  useEffect(() => { lastTrafficRef.current = Date.now(); }, [transmissionLog.length, activeSpeaker]);
  useEffect(() => {
    if (!silenceAlertMin || !currentChannel) return;
    const t = setInterval(() => {
      if (Date.now() - lastTrafficRef.current > silenceAlertMin * 60 * 1000) {
        addToast(`Channel quiet for ${silenceAlertMin}m`, 'info');
        lastTrafficRef.current = Date.now();
      }
    }, 30000);
    return () => clearInterval(t);
  }, [silenceAlertMin, currentChannel, addToast]);

  // ════════ FORMAT HELPERS ════════
  const formatLogTime = useCallback((ts: number | string) => {
    const tNum = typeof ts === 'string' ? Date.parse(ts) : ts;
    if (!tNum || tNum < 1000000000000) return '--:--:--';
    if (showRelative) {
      const diffSec = Math.floor((Date.now() - tNum) / 1000);
      if (diffSec < 60) return `${diffSec}s ago`;
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    }
    const d = new Date(tNum);
    if (time24h) return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return d.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }, [time24h, showRelative]);

  const formatDuration = (sec: number) => {
    if (!sec || sec < 0 || sec > 86400) return '';
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };
  const formatCallDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };
  const channelBusyBadge = (id: string): { label: string; color: string } => {
    const count = stats.byChan.get(id) || 0;
    if (count >= 20) return { label: 'HIGH', color: '#ef4444' };
    if (count >= 5)  return { label: 'MED',  color: '#d4a017' };
    if (count > 0)   return { label: 'LOW',  color: '#22c55e' };
    return { label: 'IDLE', color: '#444' };
  };

  // ════════ PAGE / STATUS ════════
  const sendQuickPage = (msg: string, recipient?: string) => {
    if (!currentChannel) { addToast('Join a channel first', 'error'); return; }
    try {
      sendPage(recipient || '', msg);
      setLastSentPage({ msg, recipient: recipient || '' });
      addToast(`Page sent: ${msg.slice(0, 40)}`, 'success');
      setPageMessage('');
    } catch { addToast('Page failed', 'error'); }
  };
  const broadcastStatus = (code: string, label: string) => {
    setCurrentStatus(`${code} ${label}`);
    sendQuickPage(`STATUS: ${code} ${label}`);
  };
  const repeatLastPage = () => {
    if (!lastSentPage) { addToast('No previous page', 'info'); return; }
    sendQuickPage(lastSentPage.msg, lastSentPage.recipient);
  };
  const radioCheck = () => sendQuickPage('RADIO CHECK — please ack');

  // ════════ MARKERS / ANNOTATIONS / COLORS ════════
  const toggleMark = (id: string) => setMarkedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setColorLabel = (id: string, color: string) => {
    setTxColorLabels(p => {
      const next = { ...p };
      if (next[id] === color) delete next[id]; else next[id] = color;
      return next;
    });
  };
  const startAnnotate = (id: string) => {
    setAnnotatingId(id);
    setAnnotateText(txAnnotations[id] || '');
  };
  const saveAnnotation = () => {
    if (!annotatingId) return;
    setTxAnnotations(p => {
      const next = { ...p };
      if (annotateText.trim()) next[annotatingId] = annotateText.trim();
      else delete next[annotatingId];
      return next;
    });
    setAnnotatingId(null);
    setAnnotateText('');
  };
  const copyTranscript = (entry: any) => {
    const text = entry.transcript || '';
    navigator.clipboard?.writeText(text).then(
      () => addToast('Transcript copied', 'success'),
      () => addToast('Copy failed', 'error'),
    );
  };
  const copyTimestamp = (entry: any) => {
    navigator.clipboard?.writeText(String(entry.transmitted_at || '')).then(
      () => addToast('Timestamp copied', 'success'),
      () => addToast('Copy failed', 'error'),
    );
  };

  // ════════ SEARCH ════════
  const saveCurrentSearch = () => {
    if (!historySearch.trim()) return;
    if (savedSearches.includes(historySearch.trim())) return;
    setSavedSearches(prev => [historySearch.trim(), ...prev].slice(0, 10));
  };
  const removeSavedSearch = (q: string) => setSavedSearches(prev => prev.filter(s => s !== q));
  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const terms = q.replace(/\|/g, ' ').split(/\s+/).filter(t => t && !t.startsWith('-')).map(t => t.toLowerCase());
    if (terms.length === 0) return text;
    const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(re);
    return parts.map((p, i) => re.test(p) ? <mark key={i} style={{ background: '#d4a01755', color: '#fff' }}>{p}</mark> : <span key={i}>{p}</span>);
  };

  const replayLastTx = () => {
    const last = filteredHistory.find(e => e.audio_file);
    if (!last) { addToast('No replayable transmission', 'info'); return; }
    togglePlayback(last);
  };
  const jumpToFirstMarked = () => {
    const idx = filteredHistory.findIndex(e => markedIds.has(String(e.id)));
    if (idx >= 0) { setSelectedHistoryIdx(idx); document.getElementById(`hist-row-${filteredHistory[idx].id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else addToast('No marked transmissions', 'info');
  };

  // ════════ EXPORT / PRINT ════════
  const exportHistoryCsv = () => {
    if (filteredHistory.length === 0) return;
    const header = 'Timestamp,Channel,User,Duration(s),Transcript,Marked,Color,Note,HasAudio\n';
    const rows = filteredHistory.map(e =>
      `"${e.transmitted_at}","${e.channel}","${e.full_name || e.username || ''}","${e.duration || ''}","${(e.transcript || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}","${markedIds.has(String(e.id)) ? 'Y' : ''}","${txColorLabels[String(e.id)] || ''}","${(txAnnotations[String(e.id)] || '').replace(/"/g, '""')}","${e.audio_file ? 'Y' : ''}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `radio-transcripts-${localToday()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  const exportHistoryJson = () => {
    if (filteredHistory.length === 0) return;
    const enriched = filteredHistory.map(e => ({
      ...e,
      _marked: markedIds.has(String(e.id)),
      _color: txColorLabels[String(e.id)] || null,
      _note: txAnnotations[String(e.id)] || null,
    }));
    const blob = new Blob([JSON.stringify(enriched, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `radio-transcripts-${localToday()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const printHistory = () => window.print();

  // ════════ SETTINGS RESET ════════
  const resetAllSettings = () => {
    if (!confirm('Reset ALL radio preferences? This clears favorites, mutes, settings, marks, annotations, etc.')) return;
    Object.keys(localStorage).filter(k => k.startsWith('radio_')).forEach(k => localStorage.removeItem(k));
    location.reload();
  };

  useEffect(() => { document.title = 'Radio Communications — RMPG Flex'; }, []);

  // Phonetic table for current mode
  const PHONETIC = phoneticMode === 'nato' ? PHONETIC_NATO : PHONETIC_LAPD;

  // Custom page templates
  const addTemplate = () => {
    const t = newTemplateText.trim().toUpperCase();
    if (!t) return;
    if (pageTemplates.includes(t)) return;
    setPageTemplates(prev => [...prev, t].slice(0, 24));
    setNewTemplateText('');
  };
  const removeTemplate = (t: string) => setPageTemplates(prev => prev.filter(x => x !== t));

  // Custom keyword alerts
  const addKeyword = () => {
    const k = newKeyword.trim();
    if (!k) return;
    if (keywordAlerts.includes(k)) return;
    setKeywordAlerts(prev => [...prev, k].slice(0, 20));
    setNewKeyword('');
  };
  const removeKeyword = (k: string) => setKeywordAlerts(prev => prev.filter(x => x !== k));

  // Per-user notif toggle
  const togglePerUserNotif = (id: string | number) => {
    setPerUserNotif(p => { const n = new Set(p); const s = String(id); n.has(s) ? n.delete(s) : n.add(s); return n; });
  };

  // Pinned TX from history (resolved)
  const pinnedTx = useMemo(() => {
    if (!pinnedTxId) return null;
    return historyEntries.find(e => String(e.id) === pinnedTxId) || null;
  }, [pinnedTxId, historyEntries]);

  // Now/clock displays
  const now = new Date();
  const clockStr = time24h
    ? now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : now.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // Column widths
  const widthMap = { narrow: { left: 200, right: 340 }, std: { left: 220, right: 380 }, wide: { left: 260, right: 440 } };
  const cw = widthMap[columnWidth];

  // ────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────
  const cm = compactMode;
  const themeVars = THEME_VARS[theme];
  const baseFontPct = `${FONT_SCALES[fontScale] * 100}%`;

  return (
    <div
      className="h-full flex flex-col relative"
      style={{
        background: 'var(--rt-bg)',
        color: 'var(--rt-text)',
        fontSize: baseFontPct,
        ...themeVars,
      }}
    >
      {/* Dim mode overlay */}
      {dimMode && (
        <div className="pointer-events-none absolute inset-0 z-50" style={{ background: 'rgba(0,0,0,0.45)' }} />
      )}
      {/* TX flash */}
      {flashCount > 0 && (
        <div className="pointer-events-none absolute inset-0 z-40" style={{ background: 'rgba(212,160,23,0.12)', animation: reduceMotion ? 'none' : 'flashFade 0.35s ease-out' }} />
      )}

      {/* ─── BANNERS ─── */}
      {!micSupported && (
        <Banner color="#ef4444" bg="rgba(220,38,38,0.15)" icon={<ShieldAlert style={{ width: 14, height: 14, color: '#ef4444' }} />}>
          <span className="font-bold text-red-400">SECURE CONNECTION REQUIRED</span>
          <span className="text-rmpg-400 ml-2">Microphone needs HTTPS — listening only.</span>
        </Banner>
      )}

      {panicAlert && (
        <div className={`flex items-center gap-3 px-4 py-2 ${reduceMotion ? '' : 'animate-pulse'}`} style={{ background: 'rgba(239,68,68,0.25)', borderBottom: '2px solid #ef4444' }}>
          <AlertCircle style={{ width: 18, height: 18, color: '#ef4444' }} />
          <div className="flex-1 text-[11px] font-mono">
            <span className="font-bold text-red-400 tracking-wider">⚠ EMERGENCY — {panicAlert.user_name}</span>
            {panicAlert.unit_call_sign && <span className="text-red-300 ml-1">({panicAlert.unit_call_sign})</span>}
            {panicAlert.location_address && <span className="text-red-300 ml-2">@ {panicAlert.location_address}</span>}
          </div>
          <span className="text-[9px] font-mono text-red-400 uppercase tracking-widest">LIVE</span>
        </div>
      )}

      {incomingPage && (
        <Banner color="#aaa" bg="rgba(136,136,136,0.15)" icon={<Megaphone style={{ width: 14, height: 14, color: '#aaa' }} />}>
          <span className="font-bold text-gray-300">PAGE FROM {incomingPage.from_full_name || incomingPage.from_username}</span>
          {incomingPage.message && <span className="text-gray-500 ml-2">— {incomingPage.message}</span>}
          <button type="button" onClick={dismissPage} className="ml-auto text-[9px] font-mono text-gray-400 hover:text-white px-2 py-0.5" style={{ border: '1px solid #88888880' }}>DISMISS</button>
        </Banner>
      )}

      {(isInCall && activeCall) && (
        <Banner color="#888" bg="linear-gradient(90deg, rgba(136,136,136,0.2), rgba(136,136,136,0.05))" icon={<PhoneCall style={{ width: 14, height: 14, color: '#888' }} />}>
          <span className="font-bold text-gray-200">PRIVATE CALL — {activeCall.partnerName}</span>
          <span className="text-gray-400/70 ml-2">{formatCallDuration(callDuration)}{callMuted && ' — MUTED'}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={toggleMute} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold" style={{ border: `1px solid ${callMuted ? '#ef4444' : '#2e2e2e'}`, color: callMuted ? '#ef4444' : '#888' }}>
              {callMuted ? <VolumeX style={{ width: 10, height: 10 }} /> : <Mic style={{ width: 10, height: 10 }} />}
              {callMuted ? 'UNMUTE' : 'MUTE'}
            </button>
            <button type="button" onClick={endCall} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold text-red-400" style={{ border: '1px solid #ef4444' }}>
              <PhoneOff style={{ width: 10, height: 10 }} /> END
            </button>
          </div>
        </Banner>
      )}

      {isRinging && ringingTarget && (
        <Banner color="#aaa" bg="rgba(136,136,136,0.1)" icon={<Phone style={{ width: 12, height: 12, color: '#aaa', animation: reduceMotion ? 'none' : 'radioPulse 1.5s ease infinite' }} />}>
          <span className="text-gray-300">Calling <strong>{ringingTarget.name}</strong>…</span>
          <button type="button" onClick={endCall} className="ml-auto text-[10px] font-mono text-red-400 px-2 py-0.5" style={{ border: '1px solid #ef4444' }}>CANCEL</button>
        </Banner>
      )}

      {incomingCall && (
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'rgba(34,197,94,0.18)', borderBottom: '2px solid #22c55e', animation: reduceMotion ? 'none' : 'incomingCallPulse 2s ease-in-out infinite' }}>
          <PhoneIncoming style={{ width: 18, height: 18, color: '#22c55e' }} />
          <div className="flex-1">
            <div className="text-[10px] font-mono font-bold text-green-300 tracking-wider">INCOMING CALL</div>
            <div className="text-sm font-mono font-bold text-white">{incomingCall.callerName}</div>
          </div>
          <button type="button" onClick={() => acceptCall(incomingCall.callId)} className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono font-bold text-white" style={{ background: '#22c55e', border: '1px solid #16a34a' }}>
            <Phone style={{ width: 12, height: 12 }} /> ACCEPT
          </button>
          <button type="button" onClick={() => declineCall(incomingCall.callId)} className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono font-bold text-white" style={{ background: '#ef4444', border: '1px solid #dc2626' }}>
            <PhoneOff style={{ width: 12, height: 12 }} /> DECLINE
          </button>
        </div>
      )}

      {callError && (
        <Banner color="#fbbf24" bg="rgba(245,158,11,0.08)" icon={<AlertCircle style={{ width: 12, height: 12 }} />}>
          <span className="text-amber-400">{callError}</span>
        </Banner>
      )}

      {/* ═════════════ HEADER STRIP ═════════════ */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0 flex-wrap gap-2"
        style={{ background: 'linear-gradient(180deg, var(--rt-panel) 0%, var(--rt-bg) 100%)', borderBottom: '1px solid var(--rt-border)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Antenna style={{ width: 14, height: 14, color: 'var(--rt-accent)' }} />
            <span className="text-[11px] font-mono font-bold tracking-[0.2em]" style={{ color: 'var(--rt-text)' }}>RMPG RADIO</span>
          </div>
          <Sep />
          <div className="flex items-center gap-1.5">
            <span className="led-dot" style={{ background: isConnected ? 'var(--rt-led-on)' : '#ef4444', boxShadow: `0 0 4px ${isConnected ? 'var(--rt-led-on)' : '#ef4444'}` }} />
            <span className="text-[10px] font-mono tracking-wider" style={{ color: isConnected ? 'var(--rt-led-on)' : '#ef4444' }}>
              {isConnected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
          {currentChannel && channelInfo && (
            <>
              <Sep />
              <span className="text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>CH</span>
              <span className="text-[11px] font-mono font-bold tracking-wider" style={{ color: 'var(--rt-text)' }}>{channelInfo.label}</span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>{channelInfo.freq} MHz</span>
              {monitorOnly.has(currentChannel) && <span className="text-[8px] font-mono font-bold tracking-widest px-1" style={{ background: '#88888822', color: '#aaa', border: '1px solid #88888844' }}>MONITOR</span>}
            </>
          )}
          {currentStatus && (
            <>
              <Sep />
              <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e44' }}>
                <span className="led-dot" style={{ background: '#22c55e', boxShadow: '0 0 4px #22c55e' }} />
                <span className="text-[9px] font-mono font-bold text-green-300 tracking-wider">STATUS · {currentStatus}</span>
                <button type="button" onClick={() => { setCurrentStatus(null); ls.set('radio_current_status', ''); }} aria-label="Clear status" className="ml-1 text-rmpg-500 hover:text-red-400">
                  <X style={{ width: 9, height: 9 }} />
                </button>
              </div>
            </>
          )}
          {activeCallNumber && (
            <>
              <Sep />
              <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: 'rgba(212,160,23,0.12)', border: '1px solid #d4a01744' }}>
                <span className="text-[9px] font-mono font-bold tracking-wider" style={{ color: 'var(--rt-accent)' }}>CALL · {activeCallNumber}</span>
                <button type="button" onClick={() => setActiveCallNumber('')} aria-label="Clear active call" className="ml-1 text-rmpg-500 hover:text-red-400">
                  <X style={{ width: 9, height: 9 }} />
                </button>
              </div>
            </>
          )}
          {pinnedTx && (
            <>
              <Sep />
              <div className="flex items-center gap-1 px-2 py-0.5 max-w-[300px]" style={{ background: 'rgba(212,160,23,0.08)', border: '1px solid #d4a01744' }}>
                <Pin style={{ width: 9, height: 9, color: 'var(--rt-accent)' }} />
                <span className="text-[9px] font-mono truncate" style={{ color: 'var(--rt-text)' }}>
                  {pinnedTx.full_name || pinnedTx.username}: {(pinnedTx.transcript || '').slice(0, 60)}
                </span>
                <button type="button" onClick={() => setPinnedTxId(null)} aria-label="Unpin" className="ml-1 text-rmpg-500 hover:text-red-400">
                  <PinOff style={{ width: 9, height: 9 }} />
                </button>
              </div>
            </>
          )}
          <Sep />
          <div className="flex items-center gap-1 px-2 py-0.5 font-mono" style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)' }}>
            <Clock style={{ width: 10, height: 10, color: 'var(--rt-accent)' }} />
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--rt-text)' }}>{clockStr}</span>
            <span className="text-[9px]" style={{ color: 'var(--rt-muted)' }}>{dateStr}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <ToolbarBtn onClick={enableNotifications} active={notifEnabled} title="Browser notifications">
            {notifEnabled ? <Bell style={{ width: 11, height: 11 }} /> : <BellOff style={{ width: 11, height: 11 }} />} NOTIF
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setSoundEnabled(v => !v)} active={soundEnabled} title="Beep on new TX (M)">
            {soundEnabled ? <Volume1 style={{ width: 11, height: 11 }} /> : <VolumeX style={{ width: 11, height: 11 }} />} SOUND
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length])} title="Cycle theme (T)">
            <Palette style={{ width: 11, height: 11 }} /> {theme.toUpperCase()}
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setShowSettings(v => !v)} active={showSettings} title="Settings panel">
            <SettingsIcon style={{ width: 11, height: 11 }} /> SET
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setCompactMode(v => !v)} active={cm} title="Compact mode (C)">
            {cm ? <Maximize2 style={{ width: 11, height: 11 }} /> : <Minimize2 style={{ width: 11, height: 11 }} />} {cm ? 'NORM' : 'COMPACT'}
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setTime24h(v => !v)} title="12h / 24h">
            <Clock style={{ width: 11, height: 11 }} /> {time24h ? '24H' : '12H'}
          </ToolbarBtn>
          {currentChannel && (
            <>
              <ToolbarBtn
                onClick={() => {
                  if (scanActive) stopScan();
                  else startScan(RADIO_CHANNELS.filter(c => c.id !== currentChannel).map(c => c.id));
                }}
                active={scanActive}
                title="Scan (S)"
              >
                <ScanLine style={{ width: 11, height: 11 }} /> {scanActive ? 'SCAN ON' : 'SCAN'}
              </ToolbarBtn>
              <ToolbarBtn onClick={leaveChannel} danger title="Leave channel">
                <LogOut style={{ width: 11, height: 11 }} /> LEAVE
              </ToolbarBtn>
            </>
          )}
        </div>
      </div>

      {/* ═════════════ MAIN GRID ═════════════ */}
      <div
        className="flex-1 grid grid-cols-1 overflow-hidden"
        style={{
          gridTemplateColumns: cm ? 'minmax(0, 1fr)' : `${cw.left}px minmax(0, 1fr) ${cw.right}px`,
        }}
      >

        {/* ── LEFT COLUMN ───────────────────────────────── */}
        {!cm && (
          <aside className="flex flex-col overflow-hidden" style={{ background: 'var(--rt-panel)', borderRight: '1px solid var(--rt-border)' }}>
            <div className="flex-1 overflow-y-auto">

              {/* CHANNELS */}
              <SectionHeader
                icon={<Radio style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />}
                label={`CHANNELS · ${sortedChannels.length}/${RADIO_CHANNELS.length}`}
                trailing={
                  <div className="flex items-center gap-1">
                    <MiniToggle active={favsOnly} onClick={() => setFavsOnly(v => !v)} title="Favorites only">
                      <Star style={{ width: 9, height: 9 }} />
                    </MiniToggle>
                    <MiniToggle active={hideMutedChans} onClick={() => setHideMutedChans(v => !v)} title="Hide muted channels">
                      <EyeOff style={{ width: 9, height: 9 }} />
                    </MiniToggle>
                    <MiniToggle active={false} onClick={fetchHistory} title="Refresh history">
                      <RefreshCw style={{ width: 9, height: 9 }} />
                    </MiniToggle>
                  </div>
                }
              />
              {/* Channel search */}
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)' }}>
                  <Search style={{ width: 10, height: 10, color: 'var(--rt-muted)' }} />
                  <input
                    type="text"
                    value={chanSearch}
                    onChange={(e) => setChanSearch(e.target.value)}
                    placeholder="Filter channels…"
                    aria-label="Filter channels"
                    className="flex-1 bg-transparent text-[10px] font-mono focus:outline-none placeholder:text-rmpg-600"
                    style={{ color: 'var(--rt-text)' }}
                  />
                  {chanSearch && (
                    <button type="button" onClick={() => setChanSearch('')} aria-label="Clear search"><X style={{ width: 9, height: 9, color: 'var(--rt-muted)' }} /></button>
                  )}
                </div>
              </div>

              {/* Recent channels strip */}
              {recentChans.length > 1 && (
                <div className="px-2 pb-2">
                  <div className="text-[8px] font-mono tracking-[0.2em] mb-1" style={{ color: 'var(--rt-muted)' }}>RECENT</div>
                  <div className="flex flex-wrap gap-1">
                    {recentChans.map(id => {
                      const c = RADIO_CHANNELS.find(x => x.id === id);
                      if (!c) return null;
                      return (
                        <button key={id} type="button" onClick={() => joinChannel(id)} className="text-[9px] font-mono px-1.5 py-0.5"
                          style={{ border: '1px solid var(--rt-border)', color: id === currentChannel ? 'var(--rt-accent)' : 'var(--rt-muted)', background: id === currentChannel ? 'rgba(212,160,23,0.1)' : 'transparent' }}>
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Channel rows */}
              <div className="px-1 py-1 space-y-0.5">
                {sortedChannels.map((ch, idx) => {
                  const isActive = ch.id === currentChannel;
                  const isFav = favorites.has(ch.id);
                  const isMuted = mutedChans.has(ch.id);
                  const isMonitor = monitorOnly.has(ch.id);
                  const vol = chanVolumes[ch.id] ?? 100;
                  const note = chanNotes[ch.id] || '';
                  const txCount = stats.byChan.get(ch.id) || 0;
                  const lastA = lastActivePerChannel.get(ch.id);
                  const busy = channelBusyBadge(ch.id);
                  return (
                    <div key={ch.id} className="group" style={{
                      background: isActive ? 'linear-gradient(90deg, rgba(212,160,23,0.18), transparent)' : 'transparent',
                      borderLeft: isActive ? '2px solid var(--rt-accent)' : '2px solid transparent',
                    }}>
                      <div className="flex items-center gap-1.5 px-1.5 py-1">
                        <button type="button" onClick={() => toggleFavorite(ch.id)} aria-label={isFav ? 'Unfavorite' : 'Favorite'} className="p-0.5">
                          <Star style={{ width: 10, height: 10, color: isFav ? 'var(--rt-accent)' : '#444', fill: isFav ? 'var(--rt-accent)' : 'none' }} />
                        </button>
                        <span className="text-[8px] font-mono tabular-nums w-[10px]" style={{ color: 'var(--rt-muted)' }}>{idx + 1}</span>
                        <button type="button" onClick={() => joinChannel(ch.id)} disabled={!isConnected} className="flex-1 flex items-center gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40">
                          <span className="led-dot" style={{
                            background: isActive ? (channelBusy ? '#ef4444' : 'var(--rt-led-on)') : '#333',
                            boxShadow: isActive ? `0 0 4px ${channelBusy ? '#ef4444' : 'var(--rt-led-on)'}` : 'none',
                            animation: !reduceMotion && isActive && channelBusy ? 'radioPulse 1s ease-in-out infinite' : 'none',
                          }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-mono font-bold tracking-wider truncate" style={{ color: isActive ? 'var(--rt-text)' : isMuted ? '#555' : 'var(--rt-muted)' }}>
                              {ch.label}
                            </div>
                            <div className="text-[8px] font-mono flex items-center gap-1.5 truncate">
                              <span style={{ color: isActive ? 'var(--rt-accent)' : '#555' }}>{ch.freq}</span>
                              {txCount > 0 && <span style={{ color: busy.color }}>· {busy.label}</span>}
                              {lastA && <span style={{ color: '#555' }}>· {formatLogTime(lastA)}</span>}
                            </div>
                          </div>
                        </button>
                        <button type="button" onClick={() => toggleMonitorOnly(ch.id)} aria-label={isMonitor ? 'Disable monitor-only' : 'Monitor only'} title="Monitor-only" className="p-0.5">
                          <Headphones style={{ width: 10, height: 10, color: isMonitor ? 'var(--rt-accent)' : '#444' }} />
                        </button>
                        <button type="button" onClick={() => toggleMuteChan(ch.id)} aria-label={isMuted ? 'Unmute' : 'Mute'} className="p-0.5">
                          {isMuted ? <VolumeX style={{ width: 10, height: 10, color: '#ef4444' }} /> : <Volume2 style={{ width: 10, height: 10, color: '#444' }} />}
                        </button>
                      </div>
                      {isActive && (
                        <>
                          <div className="flex items-center gap-1.5 px-2 pb-1.5">
                            <Volume1 style={{ width: 9, height: 9, color: 'var(--rt-muted)' }} />
                            <input type="range" min={0} max={100} value={vol}
                              onChange={(e) => setChanVolume(ch.id, Number(e.target.value))}
                              aria-label={`Volume for ${ch.label}`}
                              className="flex-1 h-[3px] cursor-pointer"
                              style={{ accentColor: 'var(--rt-accent)', background: '#222' }} />
                            <span className="text-[8px] font-mono tabular-nums w-[24px] text-right" style={{ color: 'var(--rt-muted)' }}>{vol}</span>
                          </div>
                          <div className="px-2 pb-2">
                            <input type="text" value={note}
                              onChange={(e) => setChanNote(ch.id, e.target.value)}
                              placeholder="Channel note (private)"
                              aria-label={`Note for ${ch.label}`}
                              className="w-full text-[9px] font-mono px-1.5 py-0.5 bg-transparent placeholder:text-rmpg-600"
                              style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* STATUS QUICKSET */}
              <SectionHeader icon={<Hash style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label="STATUS · SET" />
              <div className="px-2 py-2 grid grid-cols-2 gap-1">
                {STATUS_QUICKSET.map(s => (
                  <button key={s.code} type="button" onClick={() => broadcastStatus(s.code, s.label)} disabled={!currentChannel}
                    className="flex flex-col items-center justify-center px-1 py-1.5 text-[9px] font-mono font-bold tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ border: `1px solid ${s.color}33`, color: s.color, background: 'transparent' }}
                    title={`Broadcast: ${s.code} ${s.label}`}>
                    <span style={{ fontSize: 10 }}>{s.code}</span>
                    <span style={{ opacity: 0.7 }}>{s.label}</span>
                  </button>
                ))}
              </div>

              {/* SCRATCHPAD */}
              <SectionHeader
                icon={<StickyNote style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />}
                label="SCRATCHPAD"
                trailing={<MiniToggle active={showScratch} onClick={() => setShowScratch(v => !v)} title="Toggle"><Eye style={{ width: 9, height: 9 }} /></MiniToggle>}
              />
              {showScratch && (
                <div className="px-2 py-2">
                  <textarea
                    value={scratchpad}
                    onChange={(e) => setScratchpad(e.target.value)}
                    rows={4}
                    placeholder="Names · plates · notes…"
                    aria-label="Scratchpad"
                    className="w-full text-[10px] font-mono px-2 py-1 bg-transparent placeholder:text-rmpg-600"
                    style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}
                  />
                  <div className="flex gap-1 mt-1">
                    <button type="button" onClick={() => navigator.clipboard?.writeText(scratchpad).then(() => addToast('Copied', 'success'))} className="text-[8px] font-mono px-1.5 py-0.5"
                      style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-muted)' }}>COPY</button>
                    <button type="button" onClick={() => setScratchpad('')} className="text-[8px] font-mono px-1.5 py-0.5"
                      style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-muted)' }}>CLEAR</button>
                  </div>
                </div>
              )}

              {/* 10-CODES */}
              {!hideRefs && (
                <>
                  <SectionHeader
                    icon={<Hash style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />}
                    label="10-CODES"
                    trailing={<MiniToggle active={showCodes} onClick={() => setShowCodes(v => !v)} title="Toggle">{showCodes ? <Minimize2 style={{ width: 9, height: 9 }} /> : <Maximize2 style={{ width: 9, height: 9 }} />}</MiniToggle>}
                  />
                  {showCodes && (
                    <div className="px-2 py-1.5 grid grid-cols-1 gap-px text-[9px] font-mono">
                      {TEN_CODES.map(c => (
                        <button key={c.code} type="button"
                          onClick={() => sendQuickPage(`${c.code} — ${c.meaning}`)}
                          disabled={!currentChannel}
                          className="flex justify-between gap-2 px-1 py-0.5 hover:bg-[#161616] disabled:opacity-50 text-left"
                          title={`Click to broadcast: ${c.code} ${c.meaning}`}>
                          <span className="font-bold" style={{ color: 'var(--rt-accent)' }}>{c.code}</span>
                          <span className="truncate text-right" style={{ color: 'var(--rt-muted)' }}>{c.meaning}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* PHONETIC */}
              {!hideRefs && (
                <>
                  <SectionHeader
                    icon={<Type style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />}
                    label={`PHONETIC · ${phoneticMode.toUpperCase()}`}
                    trailing={
                      <div className="flex items-center gap-1">
                        <MiniToggle active={phoneticMode === 'lapd'} onClick={() => setPhoneticMode(m => m === 'nato' ? 'lapd' : 'nato')} title="NATO / LAPD">
                          <RefreshCw style={{ width: 9, height: 9 }} />
                        </MiniToggle>
                        <MiniToggle active={showPhonetic} onClick={() => setShowPhonetic(v => !v)} title="Toggle">
                          {showPhonetic ? <Minimize2 style={{ width: 9, height: 9 }} /> : <Maximize2 style={{ width: 9, height: 9 }} />}
                        </MiniToggle>
                      </div>
                    }
                  />
                  {showPhonetic && (
                    <>
                      <div className="px-2 py-1.5">
                        <input type="text" value={phoneticInput} onChange={(e) => setPhoneticInput(e.target.value)}
                          placeholder="Spell helper…" aria-label="Spell helper"
                          className="w-full text-[10px] font-mono px-2 py-1 bg-transparent placeholder:text-rmpg-600"
                          style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                        {phoneticInput && (
                          <div className="mt-1 text-[9px] font-mono leading-relaxed break-words" style={{ color: 'var(--rt-accent)' }}>
                            {phoneticInput.toUpperCase().split('').map(ch => PHONETIC[ch] || ch).join(' · ')}
                          </div>
                        )}
                      </div>
                      <div className="px-2 pb-2 grid grid-cols-2 gap-px text-[9px] font-mono">
                        {Object.entries(PHONETIC).map(([k, v]) => (
                          <div key={k} className="flex gap-1.5 px-1 py-0.5 hover:bg-[#161616]">
                            <span className="font-bold w-[10px]" style={{ color: 'var(--rt-accent)' }}>{k}</span>
                            <span className="truncate" style={{ color: 'var(--rt-muted)' }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* SETTINGS PANEL (toggleable inline, not pop-open modal) */}
              {showSettings && (
                <>
                  <SectionHeader icon={<SettingsIcon style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label="SETTINGS" />
                  <div className="px-2 py-2 space-y-2 text-[10px] font-mono">
                    <SettingRow label="Theme">
                      <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme"
                        className="bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5" style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                        {THEMES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                      </select>
                    </SettingRow>
                    <SettingRow label="Font scale">
                      <select value={fontScale} onChange={(e) => setFontScale(e.target.value as FontScale)} aria-label="Font scale"
                        className="bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5" style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                        <option value="sm">SMALL</option><option value="md">MEDIUM</option><option value="lg">LARGE</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Column width">
                      <select value={columnWidth} onChange={(e) => setColumnWidth(e.target.value as any)} aria-label="Column width"
                        className="bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5" style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                        <option value="narrow">NARROW</option><option value="std">STANDARD</option><option value="wide">WIDE</option>
                      </select>
                    </SettingRow>
                    <SettingCheckbox label="Reduce motion" checked={reduceMotion} onChange={setReduceMotion} />
                    <SettingCheckbox label="Dim mode" checked={dimMode} onChange={setDimMode} />
                    <SettingCheckbox label="Flash on TX" checked={flashOnTx} onChange={setFlashOnTx} />
                    <SettingCheckbox label="Page sound" checked={pageSoundEnabled} onChange={setPageSoundEnabled} />
                    <SettingCheckbox label="Hide live log" checked={hideLive} onChange={setHideLive} />
                    <SettingCheckbox label="Hide stats" checked={hideStats} onChange={setHideStats} />
                    <SettingCheckbox label="Hide top units" checked={hideTopUnits} onChange={setHideTopUnits} />
                    <SettingCheckbox label="Hide refs" checked={hideRefs} onChange={setHideRefs} />
                    <SettingCheckbox label="PTT lock mode" checked={pttLock} onChange={setPttLock} />
                    <SettingCheckbox label="Roger beep" checked={rogerBeep} onChange={setRogerBeep} />
                    <SettingCheckbox label="Pre-TX countdown" checked={countdownBeep} onChange={setCountdownBeep} />
                    <SettingCheckbox label="Auto-play next" checked={autoPlayNext} onChange={setAutoPlayNext} />
                    <SettingCheckbox label="Loop recording" checked={loopRecording} onChange={setLoopRecording} />
                    <SettingCheckbox label="Relative time" checked={showRelative} onChange={setShowRelative} />
                    <SettingRow label="Hang time">
                      <input type="number" min={0} max={2000} step={100} value={hangTimeMs}
                        onChange={(e) => setHangTimeMs(Math.max(0, Math.min(2000, Number(e.target.value) || 0)))}
                        aria-label="Hang time ms"
                        className="w-16 bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5"
                        style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                      <span className="text-[8px] ml-1" style={{ color: 'var(--rt-muted)' }}>ms</span>
                    </SettingRow>
                    <SettingRow label="Notif sound">
                      <select value={notifSound} onChange={(e) => setNotifSound(e.target.value)} aria-label="Notification sound"
                        className="bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5" style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                        {Object.keys(NOTIF_SOUNDS).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                      <button type="button" onClick={() => playBeep(notifSound, notifVolume / 100)} className="ml-1 text-[8px] font-mono px-1 py-0.5"
                        style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-muted)' }}>TEST</button>
                    </SettingRow>
                    <SettingRow label="Notif volume">
                      <input type="range" min={0} max={100} value={notifVolume} onChange={(e) => setNotifVolume(Number(e.target.value))}
                        aria-label="Notification volume" className="w-20 h-[3px] cursor-pointer" style={{ accentColor: 'var(--rt-accent)' }} />
                      <span className="text-[8px] ml-1 tabular-nums" style={{ color: 'var(--rt-muted)' }}>{notifVolume}</span>
                    </SettingRow>
                    <SettingRow label="Quiet start">
                      <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} aria-label="Quiet hours start"
                        className="bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5"
                        style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                    </SettingRow>
                    <SettingRow label="Quiet end">
                      <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} aria-label="Quiet hours end"
                        className="bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5"
                        style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                    </SettingRow>
                    <SettingRow label="Silence alert">
                      <input type="number" min={0} max={60} step={1} value={silenceAlertMin}
                        onChange={(e) => setSilenceAlertMin(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
                        aria-label="Silence alert minutes"
                        className="w-12 bg-[#0a0a0a] text-[10px] font-mono px-1 py-0.5"
                        style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                      <span className="text-[8px] ml-1" style={{ color: 'var(--rt-muted)' }}>min (0=off)</span>
                    </SettingRow>

                    {/* Keyword alerts */}
                    <div>
                      <div className="text-[8px] font-mono mb-1" style={{ color: 'var(--rt-muted)' }}>KEYWORD ALERTS</div>
                      <div className="flex gap-1 mb-1">
                        <input type="text" value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') addKeyword(); }}
                          placeholder="e.g. shots fired"
                          aria-label="Add keyword"
                          className="flex-1 text-[10px] font-mono px-1.5 py-0.5 bg-[#0a0a0a]"
                          style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                        <button type="button" onClick={addKeyword} className="text-[8px] font-mono px-2"
                          style={{ background: 'var(--rt-accent)', color: '#0a0a0a' }}>+</button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {keywordAlerts.length === 0 && <span className="text-[9px] italic" style={{ color: 'var(--rt-muted)' }}>none</span>}
                        {keywordAlerts.map(k => (
                          <span key={k} className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5" style={{ background: '#1a1a1a', color: 'var(--rt-accent)' }}>
                            {k}
                            <button type="button" onClick={() => removeKeyword(k)} aria-label={`Remove ${k}`}><X style={{ width: 8, height: 8 }} /></button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Page templates editor */}
                    <div>
                      <div className="text-[8px] font-mono mb-1" style={{ color: 'var(--rt-muted)' }}>PAGE TEMPLATES</div>
                      <div className="flex gap-1 mb-1">
                        <input type="text" value={newTemplateText} onChange={(e) => setNewTemplateText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') addTemplate(); }}
                          placeholder="ADD TEMPLATE"
                          aria-label="Add template"
                          className="flex-1 text-[10px] font-mono px-1.5 py-0.5 bg-[#0a0a0a]"
                          style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                        <button type="button" onClick={addTemplate} className="text-[8px] font-mono px-2"
                          style={{ background: 'var(--rt-accent)', color: '#0a0a0a' }}>+</button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {pageTemplates.map(t => (
                          <span key={t} className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5" style={{ background: '#1a1a1a', color: 'var(--rt-text)' }}>
                            {t}
                            <button type="button" onClick={() => removeTemplate(t)} aria-label={`Remove ${t}`}><X style={{ width: 8, height: 8 }} /></button>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Reset */}
                    <button type="button" onClick={resetAllSettings}
                      className="w-full flex items-center justify-center gap-1 px-2 py-1 text-[9px] font-mono font-bold tracking-wider mt-2"
                      style={{ border: '1px solid #ef4444', color: '#ef4444', background: 'rgba(239,68,68,0.05)' }}>
                      <Trash style={{ width: 10, height: 10 }} /> RESET ALL RADIO PREFS
                    </button>
                  </div>
                </>
              )}
            </div>
          </aside>
        )}

        {/* ── CENTER COLUMN: Console ────────────────────── */}
        <main
          className="flex flex-col overflow-y-auto"
          style={{ background: 'radial-gradient(ellipse at center top, var(--rt-panel) 0%, var(--rt-bg) 60%)' }}
        >
          {!currentChannel ? (
            <EmptyConsole isConnected={isConnected} channels={RADIO_CHANNELS.length} />
          ) : (
            <div className={`flex-1 flex flex-col items-center px-6 py-${cm ? '4' : '6'} gap-${cm ? '3' : '5'}`}>

              {/* CRT FREQ DISPLAY */}
              <div className="w-full max-w-md p-5 text-center relative overflow-hidden"
                style={{ background: 'linear-gradient(180deg, #050a05 0%, #020602 100%)', border: '2px solid #1a2a1a',
                  boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.7), 0 0 30px rgba(51,255,51,0.04)' }}>
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.2) 3px, rgba(0,0,0,0.2) 3px)',
                  mixBlendMode: 'multiply', opacity: reduceMotion ? 0.5 : 1,
                }} />
                <div className="absolute top-1.5 left-2 text-[8px] font-mono tracking-[0.3em]" style={{ color: '#1a5a1a' }}>◉ ON AIR</div>
                <div className="absolute top-1.5 right-2 text-[8px] font-mono tracking-[0.3em]" style={{ color: '#1a5a1a' }}>
                  CH-{(RADIO_CHANNELS.findIndex(c => c.id === currentChannel) + 1).toString().padStart(2, '0')}
                </div>
                <div className="text-[9px] font-mono tracking-[0.4em] mt-1 relative" style={{ color: '#1a5a1a' }}>CHANNEL</div>
                <div className="text-4xl font-bold font-mono tracking-[0.15em] mt-1 relative"
                  style={{ color: 'var(--rt-crt)', textShadow: '0 0 12px rgba(51, 255, 51, 0.5)' }}>
                  {channelInfo?.label || currentChannel.toUpperCase()}
                </div>
                <div className="text-base font-mono mt-2 tracking-widest relative" style={{ color: 'var(--rt-crt)', opacity: 0.55 }}>
                  {channelInfo?.freq || '---'} MHz
                </div>
                <div className="absolute bottom-1.5 left-2 text-[8px] font-mono tabular-nums" style={{ color: '#1a5a1a' }}>{clockStr}</div>
                <div className="absolute bottom-1.5 right-2 text-[8px] font-mono" style={{ color: '#1a5a1a' }}>{dateStr}</div>
                <div className="mt-3 pt-2 border-t border-[#0c1c0c] text-[9px] font-mono tracking-[0.3em] relative"
                  style={{ color: activeSpeaker || isTransmitting ? 'var(--rt-tx)' : '#1a5a1a' }}>
                  {isTransmitting ? `── TX · ${formatCallDuration(txTimer)} ──` : activeSpeaker ? '── TRAFFIC ──' : '── CHANNEL CLEAR ──'}
                </div>
              </div>

              {/* HOURLY SPARKLINE */}
              <div className="w-full max-w-md">
                <Sparkline values={stats.hourly} highlight={new Date().getHours()} />
              </div>

              {/* ACTIVE SPEAKER */}
              <div className="w-full max-w-md min-h-[56px] flex items-center justify-center">
                {activeSpeaker ? (
                  <div className="flex items-center justify-center gap-4 w-full px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <Waveform color="var(--rt-tx)" reduceMotion={reduceMotion} />
                    <div className="text-center">
                      <div className="text-sm font-bold font-mono tracking-wider" style={{ color: 'var(--rt-tx)' }}>
                        {activeSpeaker.fullName || activeSpeaker.username || 'Unknown'}
                      </div>
                      <div className="text-[9px] font-mono tracking-[0.3em]" style={{ color: 'var(--rt-tx)', opacity: 0.7 }}>TRANSMITTING</div>
                    </div>
                    <Waveform color="var(--rt-tx)" reverse reduceMotion={reduceMotion} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] font-mono tracking-[0.3em]" style={{ color: 'var(--rt-muted)' }}>
                    <Activity style={{ width: 11, height: 11 }} />
                    STANDBY · NO TRAFFIC
                  </div>
                )}
              </div>

              {/* PTT */}
              <button
                type="button"
                ref={pttRef}
                onClick={pttLock ? () => { if (isTransmitting) stopTransmitWrapped(); else startTransmitWrapped(); } : undefined}
                onMouseDown={!pttLock ? () => startTransmitWrapped() : undefined}
                onMouseUp={!pttLock ? () => stopTransmitWrapped() : undefined}
                onMouseLeave={!pttLock ? () => { if (isTransmitting) stopTransmitWrapped(); } : undefined}
                onTouchStart={!pttLock ? (e) => { e.preventDefault(); startTransmitWrapped(); } : undefined}
                onTouchEnd={!pttLock ? (e) => { e.preventDefault(); stopTransmitWrapped(); } : undefined}
                disabled={!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall || (currentChannel ? monitorOnly.has(currentChannel) : false)}
                aria-label="Push to talk"
                className="radio-ptt-btn relative flex items-center justify-center select-none"
                style={{
                  width: cm ? 140 : 200, height: cm ? 140 : 200,
                  background: isInCall ? 'radial-gradient(circle at 30% 30%, #2b2b2b, #141414, #0c0c0c)'
                    : !micSupported ? 'radial-gradient(circle at 30% 30%, #2a2a2a, #181818, #0c0c0c)'
                    : isTransmitting ? 'radial-gradient(circle at 30% 30%, #ff5050, #c41e1e, #5a0a0a)'
                    : otherSpeaking ? 'radial-gradient(circle at 30% 30%, #d4a017, #8a6810, #3a2c06)'
                    : 'radial-gradient(circle at 30% 30%, #33aa33, #1e7a1e, #0a3a0a)',
                  border: isInCall ? '5px solid #88888880'
                    : !micSupported ? '5px solid #2a2a2a'
                    : isTransmitting ? '5px solid #ff6060'
                    : otherSpeaking ? '5px solid #d4a017' : '5px solid #2a8a2a',
                  boxShadow: isTransmitting
                    ? '0 0 40px rgba(255,64,64,0.6), inset 0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 8px rgba(255,255,255,0.1)'
                    : otherSpeaking ? '0 0 28px rgba(212,160,23,0.4), inset 0 4px 12px rgba(0,0,0,0.5)'
                    : '0 0 24px rgba(34,170,34,0.35), inset 0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 8px rgba(255,255,255,0.08)',
                  cursor: (!isConnected || !micSupported || isInCall) ? 'not-allowed' : 'pointer',
                  opacity: (!isConnected || !micSupported || isInCall) ? 0.4 : 1,
                  transition: 'all 0.12s ease',
                  touchAction: 'none',
                  transform: isTransmitting ? 'scale(0.97)' : 'scale(1)',
                }}
              >
                {isTransmitting && !reduceMotion && (
                  <div className="absolute inset-[-12px] rounded-full pointer-events-none"
                    style={{ border: '2px solid rgba(255,64,64,0.5)', animation: 'radioPulse 1.2s ease-out infinite' }} />
                )}
                {pttLock && (
                  <div className="absolute top-2 right-2 px-1.5 py-0.5 text-[8px] font-mono font-bold tracking-widest"
                    style={{ background: 'rgba(0,0,0,0.4)', color: '#fff' }}>LOCK</div>
                )}
                <div className="flex flex-col items-center gap-1">
                  {isInCall ? <PhoneCall style={{ width: 36, height: 36, color: '#aaa' }} />
                    : !micSupported ? <MicOff style={{ width: 36, height: 36, color: '#666' }} />
                    : isTransmitting ? <Mic style={{ width: 36, height: 36, color: '#fff' }} />
                    : otherSpeaking ? <Volume2 style={{ width: 36, height: 36, color: '#fff' }} />
                    : <Mic style={{ width: 36, height: 36, color: '#eaffea' }} />}
                  <span className="text-[11px] font-mono font-black tracking-[0.3em]" style={{ color: '#fff' }}>
                    {isInCall ? 'IN CALL' : !micSupported ? 'NO MIC' : isTransmitting ? `TX ${formatCallDuration(txTimer)}` : otherSpeaking ? 'RX' : 'PTT'}
                  </span>
                </div>
              </button>

              {/* HINT */}
              <div className="text-center min-h-[18px]">
                {isInCall ? <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--rt-muted)' }}>PTT DISABLED — PRIVATE CALL</span>
                : !micSupported ? <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--rt-muted)' }}>HTTPS REQUIRED — LISTENING ONLY</span>
                : currentChannel && monitorOnly.has(currentChannel) ? <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--rt-accent)' }}>MONITOR-ONLY MODE</span>
                : isTransmitting ? <span className={`text-[10px] font-mono tracking-wider ${reduceMotion ? '' : 'animate-pulse'}`} style={{ color: 'var(--rt-tx)' }}>▮ TRANSMITTING — {pttLock ? 'CLICK TO STOP' : 'RELEASE TO STOP'}</span>
                : otherSpeaking ? <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--rt-accent)' }}>{activeSpeaker?.fullName || activeSpeaker?.username || 'Unknown'} HAS THE FLOOR</span>
                : <span className="text-[10px] font-mono tracking-wider" style={{ color: 'var(--rt-muted)' }}>{pttLock ? <>CLICK PTT OR <Kbd>SPACE</Kbd> TO TOGGLE</> : <>HOLD <Kbd>SPACE</Kbd> OR PTT TO TALK</>}</span>}
              </div>

              {/* MODE TOGGLES */}
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                <ModeToggle active={pttLock} onClick={() => setPttLock(v => !v)} icon={<Repeat style={{ width: 10, height: 10 }} />} label="PTT LOCK" />
                <ModeToggle active={rogerBeep} onClick={() => setRogerBeep(v => !v)} icon={<Bell style={{ width: 10, height: 10 }} />} label="ROGER BEEP" />
                <ModeToggle active={countdownBeep} onClick={() => setCountdownBeep(v => !v)} icon={<AlarmClock style={{ width: 10, height: 10 }} />} label="COUNTDOWN" />
                <ModeToggle active={hangTimeMs > 0} onClick={() => setHangTimeMs(hangTimeMs > 0 ? 0 : 500)} icon={<Clock style={{ width: 10, height: 10 }} />} label={`HANG ${hangTimeMs}ms`} />
              </div>

              {/* QUICK ACTIONS */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <button type="button" onClick={radioCheck} disabled={!currentChannel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider hover:text-white disabled:opacity-30"
                  style={{ border: '1px solid var(--rt-border)', background: 'var(--rt-panel)', color: 'var(--rt-text)' }}>
                  <RefreshCw style={{ width: 10, height: 10 }} /> RADIO CHECK
                </button>
                <button type="button" onClick={replayLastTx}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider hover:text-white"
                  style={{ border: '1px solid var(--rt-border)', background: 'var(--rt-panel)', color: 'var(--rt-text)' }}>
                  <Rewind style={{ width: 10, height: 10 }} /> REPLAY LAST
                </button>
                <button type="button" onClick={repeatLastPage} disabled={!lastSentPage || !currentChannel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider hover:text-white disabled:opacity-30"
                  style={{ border: '1px solid var(--rt-border)', background: 'var(--rt-panel)', color: 'var(--rt-text)' }}>
                  <Repeat style={{ width: 10, height: 10 }} /> REPEAT PAGE
                </button>
                <button type="button" onClick={() => setSilenceAlertMin(silenceAlertMin === 0 ? 5 : 0)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider hover:text-white"
                  style={{ border: '1px solid var(--rt-border)', background: 'var(--rt-panel)', color: silenceAlertMin > 0 ? 'var(--rt-accent)' : 'var(--rt-muted)' }}
                  title="Toggle silence-alert (5 min)">
                  <Bell style={{ width: 10, height: 10 }} /> SILENCE {silenceAlertMin > 0 ? `${silenceAlertMin}m` : 'OFF'}
                </button>
              </div>

              {/* PAGE COMPOSER */}
              <div className="w-full max-w-md" style={{ background: 'var(--rt-panel)', border: '1px solid var(--rt-border)' }}>
                <SectionHeader icon={<Megaphone style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label={`PAGE / TEXT COMPOSER${lastSentPage ? ' · LAST: ' + lastSentPage.msg.slice(0, 24) : ''}`} />
                <div className="p-2 space-y-2">
                  <div className="flex gap-1.5">
                    <input type="text" value={pageRecipient} onChange={(e) => setPageRecipient(e.target.value)} list="page-recipient-list"
                      placeholder="Call sign" aria-label="Page recipient"
                      className="w-32 text-[10px] font-mono px-2 py-1 bg-[#0a0a0a] placeholder:text-rmpg-600"
                      style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                    <datalist id="page-recipient-list">
                      {channelUsers.map(u => <option key={u.userId} value={u.username || u.fullName || ''} />)}
                    </datalist>
                    <input type="text" value={pageMessage} onChange={(e) => setPageMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && pageMessage) sendQuickPage(pageMessage, pageRecipient); }}
                      placeholder="Message…" aria-label="Page message"
                      className="flex-1 text-[10px] font-mono px-2 py-1 bg-[#0a0a0a] placeholder:text-rmpg-600"
                      style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                    <button type="button" onClick={() => sendQuickPage(pageMessage, pageRecipient)} disabled={!pageMessage || !currentChannel}
                      className="px-3 py-1 text-[10px] font-mono font-bold tracking-wider disabled:opacity-30"
                      style={{ background: 'var(--rt-accent)', color: '#0a0a0a' }}>
                      <Send style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} /> SEND
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {pageTemplates.map(t => (
                      <button key={t} type="button" onClick={() => sendQuickPage(t, pageRecipient)} disabled={!currentChannel}
                        className="text-[9px] font-mono px-1.5 py-0.5 disabled:opacity-30"
                        style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-muted)' }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ACTIVE CALL # ENTRY */}
              <div className="w-full max-w-md" style={{ background: 'var(--rt-panel)', border: '1px solid var(--rt-border)' }}>
                <div className="px-3 py-1.5 flex items-center gap-2">
                  <Hash style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />
                  <span className="text-[9px] font-mono font-bold tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>ACTIVE CALL #</span>
                  <input type="text" value={activeCallNumber} onChange={(e) => setActiveCallNumber(e.target.value)}
                    placeholder="CFS00000" aria-label="Active call number"
                    className="flex-1 text-[10px] font-mono px-2 py-0.5 bg-[#0a0a0a]"
                    style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }} />
                </div>
              </div>

              {/* SHORTCUTS */}
              <div className="w-full max-w-md text-[9px] font-mono text-center leading-relaxed" style={{ color: 'var(--rt-muted)' }}>
                SHORTCUTS · <Kbd>SPACE</Kbd> tx · <Kbd>1-9</Kbd> chan · <Kbd>S</Kbd> scan · <Kbd>M</Kbd> sound · <Kbd>C</Kbd> compact · <Kbd>L</Kbd> lock · <Kbd>T</Kbd> theme · <Kbd>D</Kbd> dim · <Kbd>R</Kbd> motion · <Kbd>J</Kbd>/<Kbd>K</Kbd> nav
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-mono text-red-400 max-w-md" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.2)' }}>
                  <AlertCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── RIGHT COLUMN ─────────────────────────────── */}
        {!cm && (
          <aside className="flex flex-col overflow-hidden" style={{ background: 'var(--rt-panel)', borderLeft: '1px solid var(--rt-border)' }}>

            {/* Search bar */}
            <div className="flex-shrink-0 px-2 py-2 flex items-center gap-1.5 relative flex-wrap"
              style={{ background: 'linear-gradient(180deg, #181818, #141414)', borderBottom: '1px solid var(--rt-border)' }}>
              <Search style={{ width: 11, height: 11, color: 'var(--rt-muted)' }} />
              <input type="text" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}
                onFocus={() => setShowSearchHistory(true)}
                onBlur={() => setTimeout(() => setShowSearchHistory(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && historySearch.trim()) {
                    setSearchHistory(prev => [historySearch, ...prev.filter(s => s !== historySearch)].slice(0, 8));
                  }
                }}
                placeholder="search · supports | OR / -negate"
                aria-label="Search transcripts"
                className="flex-1 bg-transparent text-[10px] font-mono focus:outline-none placeholder:text-rmpg-600 min-w-0"
                style={{ color: 'var(--rt-text)' }} />
              <select value={historyChannel} onChange={(e) => setHistoryChannel(e.target.value)} aria-label="Filter by channel"
                className="bg-[#0a0a0a] text-[9px] font-mono px-1 py-0.5"
                style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                <option value="">CH</option>
                {RADIO_CHANNELS.map(ch => <option key={ch.id} value={ch.id}>{ch.label}</option>)}
              </select>
              <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} aria-label="Date range"
                className="bg-[#0a0a0a] text-[9px] font-mono px-1 py-0.5"
                style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                {DATE_RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value)} aria-label="Duration filter"
                className="bg-[#0a0a0a] text-[9px] font-mono px-1 py-0.5"
                style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-text)' }}>
                {DURATION_FILTERS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              <button type="button" onClick={saveCurrentSearch} disabled={!historySearch.trim()} title="Save search" aria-label="Save search"
                className="p-1 hover:text-[#d4a017] disabled:opacity-30" style={{ color: 'var(--rt-muted)' }}>
                <Save style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={exportHistoryCsv} disabled={filteredHistory.length === 0} title="Export CSV" aria-label="Export CSV"
                className="p-1 hover:text-[#d4a017] disabled:opacity-30" style={{ color: 'var(--rt-muted)' }}>
                <Download style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={exportHistoryJson} disabled={filteredHistory.length === 0} title="Export JSON" aria-label="Export JSON"
                className="p-1 hover:text-[#d4a017] disabled:opacity-30" style={{ color: 'var(--rt-muted)' }}>
                <FileJson style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={printHistory} title="Print" aria-label="Print" className="p-1 hover:text-[#d4a017]" style={{ color: 'var(--rt-muted)' }}>
                <Printer style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={() => setAutoScrollLock(v => !v)} title="Auto-scroll lock (L)" aria-label="Auto-scroll lock"
                className="p-1" style={{ color: autoScrollLock ? 'var(--rt-accent)' : 'var(--rt-muted)' }}>
                {autoScrollLock ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
              </button>

              {showSearchHistory && (savedSearches.length > 0 || searchHistory.length > 0) && (
                <div className="absolute top-full left-0 right-0 z-30 max-h-48 overflow-y-auto"
                  style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)', borderTop: 'none' }}>
                  {savedSearches.length > 0 && <div className="px-2 py-1 text-[8px] font-mono tracking-wider" style={{ color: 'var(--rt-muted)' }}>SAVED</div>}
                  {savedSearches.map(s => (
                    <div key={'sv'+s} className="flex items-center gap-1 px-2 py-1 hover:bg-[#161616]">
                      <Bookmark style={{ width: 9, height: 9, color: 'var(--rt-accent)' }} />
                      <button type="button" onMouseDown={() => setHistorySearch(s)} className="flex-1 text-left text-[10px] font-mono truncate" style={{ color: 'var(--rt-text)' }}>{s}</button>
                      <button type="button" onMouseDown={() => removeSavedSearch(s)} aria-label="Remove saved search" style={{ color: 'var(--rt-muted)' }}><X style={{ width: 9, height: 9 }} /></button>
                    </div>
                  ))}
                  {searchHistory.length > 0 && <div className="px-2 py-1 text-[8px] font-mono tracking-wider mt-1" style={{ color: 'var(--rt-muted)' }}>RECENT</div>}
                  {searchHistory.map(s => (
                    <button key={'rc'+s} type="button" onMouseDown={() => setHistorySearch(s)} className="w-full flex items-center gap-1 px-2 py-1 text-left hover:bg-[#161616]">
                      <Clock style={{ width: 9, height: 9, color: 'var(--rt-muted)' }} />
                      <span className="flex-1 text-[10px] font-mono truncate" style={{ color: 'var(--rt-text)' }}>{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick filter chips */}
            <div className="flex items-center gap-1 px-2 py-1.5 flex-wrap" style={{ borderBottom: '1px solid var(--rt-border)' }}>
              <FilterChip active={dateRange === 'today'} onClick={() => setDateRange(dateRange === 'today' ? 'all' : 'today')}>TODAY</FilterChip>
              <FilterChip active={markedOnlyFilter} onClick={() => setMarkedOnlyFilter(v => !v)} icon={<BookmarkCheck style={{ width: 9, height: 9 }} />}>MARKED</FilterChip>
              <FilterChip active={hasAudioFilter} onClick={() => setHasAudioFilter(v => !v)} icon={<Volume2 style={{ width: 9, height: 9 }} />}>AUDIO</FilterChip>
              <FilterChip active={excludeSelfFilter} onClick={() => setExcludeSelfFilter(v => !v)}>NOT-ME</FilterChip>
              {COLOR_LABELS.map(c => (
                <button key={c.id} type="button" onClick={() => setColorFilter(colorFilter === c.id ? '' : c.id)}
                  aria-label={`Color ${c.label}`} title={`Filter by ${c.label}`}
                  className="w-5 h-5 flex items-center justify-center"
                  style={{ background: colorFilter === c.id ? c.color : 'transparent', border: `1px solid ${c.color}` }}>
                  <span style={{ width: 6, height: 6, background: c.color, display: 'inline-block', borderRadius: 0 }} />
                </button>
              ))}
              <span className="text-[9px] font-mono ml-auto" style={{ color: 'var(--rt-muted)' }}>
                {filteredHistory.length}/{historyEntries.length}
              </span>
              <button type="button" onClick={jumpToFirstMarked} title="Jump to first marked" aria-label="Jump to first marked"
                className="p-0.5" style={{ color: 'var(--rt-muted)' }}>
                <BookmarkCheck style={{ width: 11, height: 11 }} />
              </button>
            </div>

            {/* Active filter pills */}
            {(filterUserId || historyChannel || colorFilter) && (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono flex-wrap" style={{ background: '#1a1a1a', borderBottom: '1px solid var(--rt-border)' }}>
                <Filter style={{ width: 9, height: 9, color: 'var(--rt-accent)' }} />
                <span style={{ color: 'var(--rt-muted)' }}>FILTER:</span>
                {filterUserId && (
                  <button type="button" onClick={() => setFilterUserId(null)} className="flex items-center gap-1 px-1.5 py-0.5"
                    style={{ border: '1px solid #d4a01744', color: 'var(--rt-accent)' }}>
                    USER · #{filterUserId} <X style={{ width: 8, height: 8 }} />
                  </button>
                )}
                {historyChannel && (
                  <button type="button" onClick={() => setHistoryChannel('')} className="flex items-center gap-1 px-1.5 py-0.5"
                    style={{ border: '1px solid #d4a01744', color: 'var(--rt-accent)' }}>
                    CH · {historyChannel} <X style={{ width: 8, height: 8 }} />
                  </button>
                )}
                {colorFilter && (
                  <button type="button" onClick={() => setColorFilter('')} className="flex items-center gap-1 px-1.5 py-0.5"
                    style={{ border: '1px solid #d4a01744', color: 'var(--rt-accent)' }}>
                    COLOR · {colorFilter.toUpperCase()} <X style={{ width: 8, height: 8 }} />
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">

              {/* PINNED RECORDING */}
              {pinnedRecordingId && (() => {
                const pe = historyEntries.find(e => String(e.id) === pinnedRecordingId);
                if (!pe) return null;
                return (
                  <>
                    <SectionHeader icon={<Pin style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label="PINNED RECORDING"
                      trailing={<button type="button" onClick={() => setPinnedRecordingId(null)} aria-label="Unpin" className="text-rmpg-500 hover:text-red-400"><PinOff style={{ width: 9, height: 9 }} /></button>} />
                    <div className="px-2 py-1.5 text-[10px] font-mono" style={{ background: 'rgba(212,160,23,0.05)' }}>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => togglePlayback(pe)} aria-label="Play pinned" className="p-1">
                          {playingId === pe.id ? <Square size={11} className="text-red-400" /> : <Play size={11} className="text-green-400" />}
                        </button>
                        <span style={{ color: 'var(--rt-text)' }}>{pe.full_name || pe.username}</span>
                        <span className="text-[8px] tabular-nums" style={{ color: 'var(--rt-muted)' }}>{formatLogTime(pe.transmitted_at)}</span>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* ON CHANNEL */}
              <SectionHeader icon={<Users style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label={`ON CHANNEL · ${channelUsers.length}`} />
              <div className="px-2 py-1">
                {!currentChannel ? (
                  <div className="px-1 py-1 text-[10px] font-mono italic" style={{ color: 'var(--rt-muted)' }}>No channel joined</div>
                ) : channelUsers.length === 0 ? (
                  <div className="px-1 py-1 text-[10px] font-mono italic" style={{ color: 'var(--rt-muted)' }}>Waiting for units…</div>
                ) : (
                  channelUsers.map((u) => {
                    const isMe = u.userId === Number(user?.id);
                    const isSpeaking = activeSpeaker?.userId === u.userId;
                    const isPriority = perUserNotif.has(String(u.userId));
                    return (
                      <div key={u.userId} className="group flex items-center gap-2 px-1 py-1 hover:bg-[#161616]">
                        <span className="led-dot" style={{ background: isSpeaking ? 'var(--rt-tx)' : 'var(--rt-led-on)', boxShadow: `0 0 4px ${isSpeaking ? 'var(--rt-tx)' : 'var(--rt-led-on)'}` }} />
                        <button type="button" onClick={() => setFilterUserId(u.userId === filterUserId ? null : u.userId)} className="flex-1 min-w-0 text-left" title="Click to filter their transmissions">
                          <div className="text-[11px] font-mono truncate" style={{ color: 'var(--rt-text)' }}>
                            {u.fullName || u.username || 'Unknown'}
                            {isMe && <span className="text-[8px] font-mono ml-1" style={{ color: 'var(--rt-accent)' }}>YOU</span>}
                          </div>
                          {u.role && <div className="text-[8px] font-mono uppercase tracking-wider" style={{ color: 'var(--rt-muted)' }}>{u.role}</div>}
                        </button>
                        <button type="button" onClick={() => togglePerUserNotif(u.userId)} aria-label={isPriority ? 'Remove priority' : 'Priority notify'}
                          title={isPriority ? 'Remove priority' : 'Priority notify on this user'}
                          className="p-0.5">
                          <Star style={{ width: 10, height: 10, color: isPriority ? 'var(--rt-accent)' : '#444', fill: isPriority ? 'var(--rt-accent)' : 'none' }} />
                        </button>
                        {!isMe && !isInCall && (
                          <button type="button" onClick={() => startCall(u.userId)} aria-label={`Call ${u.fullName || u.username}`}
                            title={`Call ${u.fullName || u.username}`}
                            className="opacity-0 group-hover:opacity-100 p-1" style={{ color: 'var(--rt-muted)' }}>
                            <Phone style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* TODAY STATS */}
              {!hideStats && (
                <>
                  <SectionHeader icon={<BarChart3 style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label="TODAY · STATS" />
                  <div className="px-2 py-1.5 grid grid-cols-2 gap-1.5">
                    <Stat label="MY TX" value={String(stats.myTxCount)} />
                    <Stat label="MY AIR" value={formatDuration(stats.myAirSec) || '0s'} />
                    <Stat label="ALL TX" value={String(stats.allTxCount)} />
                    <Stat label="ALL AIR" value={formatDuration(stats.allAirSec) || '0s'} />
                  </div>
                </>
              )}

              {/* TOP UNITS */}
              {!hideTopUnits && (
                <>
                  <SectionHeader icon={<TrendingUp style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />} label="TOP UNITS · TODAY" />
                  <div className="px-2 py-1">
                    {stats.top.length === 0 ? (
                      <div className="px-1 text-[10px] font-mono italic" style={{ color: 'var(--rt-muted)' }}>No traffic today</div>
                    ) : stats.top.map((t, i) => (
                      <div key={t.name + i} className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] font-mono">
                        <span className="font-bold w-[14px]" style={{ color: 'var(--rt-accent)' }}>{i + 1}.</span>
                        <span className="flex-1 truncate" style={{ color: 'var(--rt-text)' }}>{t.name}</span>
                        <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{t.count}</span>
                        <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{formatDuration(t.sec) || '0s'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* LIVE LOG */}
              {!hideLive && (
                <>
                  <SectionHeader
                    icon={<span className="led-dot" style={{ background: 'var(--rt-tx)', boxShadow: '0 0 4px var(--rt-tx)' }} />}
                    label={`LIVE · ${transmissionLog.length}`}
                  />
                  <div className="px-2 py-1">
                    {transmissionLog.length === 0 ? (
                      <div className="px-1 text-[10px] font-mono italic" style={{ color: 'var(--rt-muted)' }}>No live traffic</div>
                    ) : transmissionLog.slice().reverse().slice(0, 10).map(entry => {
                      const isMe = Number(entry.userId) === Number(user?.id);
                      return (
                        <div key={entry.id} className="flex items-start gap-2 py-0.5 border-b" style={{ borderColor: '#171717', background: isMe ? 'rgba(212,160,23,0.06)' : 'transparent' }}>
                          <span className="text-[9px] font-mono tabular-nums flex-shrink-0 mt-px" style={{ color: 'var(--rt-muted)' }}>
                            {formatLogTime(entry.startedAt)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-mono truncate" style={{ color: 'var(--rt-text)' }}>
                                {entry.fullName || entry.username || 'Unknown'}{isMe && <span style={{ color: 'var(--rt-accent)' }}> ·YOU</span>}
                              </span>
                              <button type="button" onClick={() => setHistoryChannel(historyChannel === entry.channel ? '' : entry.channel)}
                                className="text-[8px] font-mono font-bold tracking-wider px-1" style={{ background: '#1a1a1a', color: 'var(--rt-accent)' }}>
                                {(entry.channel || '').toUpperCase()}
                              </button>
                            </div>
                            {entry.transcript && <div className="text-[10px] font-mono italic mt-0.5 leading-snug" style={{ color: 'var(--rt-muted)' }}>"{entry.transcript}"</div>}
                          </div>
                          {entry.hasAudio && <Volume2 size={10} style={{ color: '#22c55e' }} className="flex-shrink-0 mt-px" />}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* HISTORY */}
              <SectionHeader icon={<Activity style={{ width: 11, height: 11, color: 'var(--rt-accent)' }} />}
                label={`HISTORY · ${filteredHistory.length}${markedIds.size ? ` · ${markedIds.size} marked` : ''}`} />
              <div className="px-2 py-1">
                {historyLoading ? (
                  <div className="px-1 py-2 text-[10px] font-mono italic" style={{ color: 'var(--rt-muted)' }}>Loading…</div>
                ) : filteredHistory.length === 0 ? (
                  <div className="px-1 py-2 text-[10px] font-mono italic" style={{ color: 'var(--rt-muted)' }}>No archived transmissions</div>
                ) : filteredHistory.map((entry, idx) => {
                  const isMe = Number(entry.user_id) === Number(user?.id);
                  const isMarked = markedIds.has(String(entry.id));
                  const colorId = txColorLabels[String(entry.id)];
                  const colorMeta = COLOR_LABELS.find(c => c.id === colorId);
                  const note = txAnnotations[String(entry.id)];
                  const isSelected = idx === selectedHistoryIdx;
                  const isPinnedHeader = pinnedTxId === String(entry.id);
                  const isPinnedRec = pinnedRecordingId === String(entry.id);
                  return (
                    <div
                      key={entry.id}
                      id={`hist-row-${entry.id}`}
                      className="py-1 border-b"
                      style={{
                        borderColor: '#171717',
                        background: isSelected ? 'rgba(212,160,23,0.15)'
                          : isMarked ? 'rgba(212,160,23,0.08)'
                          : colorMeta ? `${colorMeta.color}10`
                          : isMe ? 'rgba(212,160,23,0.05)' : 'transparent',
                        borderLeft: colorMeta ? `2px solid ${colorMeta.color}` : '2px solid transparent',
                      }}
                    >
                      <div className="flex items-start gap-1.5">
                        <span className="text-[9px] font-mono tabular-nums flex-shrink-0 mt-px w-[58px]" style={{ color: 'var(--rt-muted)' }}>
                          {formatLogTime(entry.transmitted_at)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            <button type="button" onClick={() => setFilterUserId(Number(entry.user_id) === filterUserId ? null : Number(entry.user_id))}
                              className="text-[10px] font-mono truncate hover:text-[var(--rt-accent)]" style={{ color: 'var(--rt-text)' }} title="Filter by this user">
                              {entry.full_name || entry.username || 'Unknown'}{isMe && <span style={{ color: 'var(--rt-accent)' }}> ·YOU</span>}
                            </button>
                            <button type="button" onClick={() => setHistoryChannel(historyChannel === entry.channel ? '' : entry.channel)}
                              className="text-[8px] font-mono font-bold tracking-wider px-1 hover:bg-[#222]" style={{ background: '#1a1a1a', color: 'var(--rt-accent)' }}>
                              {(entry.channel || '').toUpperCase()}
                            </button>
                            {entry.duration > 0 && <span className="text-[8px] font-mono" style={{ color: 'var(--rt-muted)' }}>{formatDuration(entry.duration)}</span>}
                            {colorMeta && <span className="text-[7px] font-mono font-bold tracking-wider px-1" style={{ background: colorMeta.color, color: '#0a0a0a' }}>{colorMeta.label}</span>}
                          </div>
                          {entry.transcript && (
                            <div className="text-[10px] font-mono italic mt-0.5 leading-snug" style={{ color: 'var(--rt-muted)' }}>
                              "{highlight(entry.transcript, historySearch)}"
                            </div>
                          )}
                          {note && (
                            <div className="text-[9px] font-mono mt-0.5 leading-snug px-1.5 py-0.5" style={{ color: 'var(--rt-accent)', background: 'rgba(212,160,23,0.06)', borderLeft: '2px solid var(--rt-accent)' }}>
                              📝 {note}
                            </div>
                          )}
                          {annotatingId === String(entry.id) && (
                            <div className="mt-1 flex gap-1">
                              <input type="text" value={annotateText} onChange={(e) => setAnnotateText(e.target.value)} autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') saveAnnotation(); if (e.key === 'Escape') setAnnotatingId(null); }}
                                placeholder="Annotation…" aria-label="Annotation"
                                className="flex-1 text-[10px] font-mono px-1.5 py-0.5 bg-[#0a0a0a]"
                                style={{ border: '1px solid var(--rt-accent)', color: 'var(--rt-text)' }} />
                              <button type="button" onClick={saveAnnotation} className="text-[9px] font-mono px-2"
                                style={{ background: 'var(--rt-accent)', color: '#0a0a0a' }}>SAVE</button>
                              <button type="button" onClick={() => setAnnotatingId(null)} className="text-[9px] font-mono px-2"
                                style={{ border: '1px solid var(--rt-border)', color: 'var(--rt-muted)' }}>×</button>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0 mt-px">
                          {/* Color labels */}
                          <div className="flex items-center gap-0.5">
                            {COLOR_LABELS.map(c => (
                              <button key={c.id} type="button" onClick={() => setColorLabel(String(entry.id), c.id)}
                                aria-label={`Label ${c.label}`} title={c.label}
                                className="w-2 h-2 transition-opacity"
                                style={{ background: colorId === c.id ? c.color : 'transparent', border: `1px solid ${c.color}`, opacity: colorId === c.id ? 1 : 0.4 }} />
                            ))}
                          </div>
                          <button type="button" onClick={() => toggleMark(String(entry.id))} className="p-0.5"
                            aria-label={isMarked ? 'Unmark' : 'Mark important'} title={isMarked ? 'Unmark' : 'Mark important'}>
                            {isMarked ? <BookmarkCheck size={11} style={{ color: 'var(--rt-accent)' }} />
                              : <Bookmark size={11} style={{ color: 'var(--rt-muted)' }} className="hover:text-[var(--rt-accent)]" />}
                          </button>
                          <button type="button" onClick={() => startAnnotate(String(entry.id))} className="p-0.5"
                            aria-label="Annotate" title="Annotate">
                            <StickyNote size={11} style={{ color: note ? 'var(--rt-accent)' : 'var(--rt-muted)' }} />
                          </button>
                          <button type="button" onClick={() => setPinnedTxId(isPinnedHeader ? null : String(entry.id))} className="p-0.5"
                            aria-label={isPinnedHeader ? 'Unpin from header' : 'Pin to header'} title={isPinnedHeader ? 'Unpin' : 'Pin to header'}>
                            {isPinnedHeader ? <PinOff size={11} style={{ color: 'var(--rt-accent)' }} /> : <Pin size={11} style={{ color: 'var(--rt-muted)' }} />}
                          </button>
                          <button type="button" onClick={() => copyTranscript(entry)} className="p-0.5" aria-label="Copy transcript" title="Copy transcript">
                            <Copy size={11} style={{ color: 'var(--rt-muted)' }} />
                          </button>
                          {entry.audio_file && (
                            <>
                              <button type="button" onClick={() => togglePlayback(entry)} className="p-0.5"
                                title={playingId === entry.id ? 'Stop' : 'Play'} aria-label={playingId === entry.id ? 'Stop playback' : 'Play recording'}>
                                {playingId === entry.id ? <Square size={11} className="text-red-400" /> : <Play size={11} className="text-green-400" />}
                              </button>
                              <button type="button" onClick={() => setPinnedRecordingId(isPinnedRec ? null : String(entry.id))} className="p-0.5"
                                title={isPinnedRec ? 'Unpin recording' : 'Pin recording'} aria-label="Pin recording">
                                {isPinnedRec ? <PinOff size={11} style={{ color: 'var(--rt-accent)' }} /> : <ListMusic size={11} style={{ color: 'var(--rt-muted)' }} />}
                              </button>
                              <button type="button" onClick={() => copyAudioLink(entry)} className="p-0.5" title="Copy audio link" aria-label="Copy audio link">
                                <Copy size={11} style={{ color: 'var(--rt-muted)' }} />
                              </button>
                              <button type="button" onClick={() => downloadRecording(entry)} className="p-0.5"
                                title="Download" aria-label={`Download recording from ${entry.full_name || entry.username || 'unit'}`}>
                                <Download size={11} style={{ color: 'var(--rt-muted)' }} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {playingId === entry.id && playbackDuration > 0 && (
                        <div className="mt-1.5 pl-[60px] pr-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono tabular-nums w-[34px] text-right" style={{ color: 'var(--rt-muted)' }}>
                              {formatDuration(Math.floor(playbackTime))}
                            </span>
                            <input type="range" min={0} max={playbackDuration} step={0.1} value={playbackTime}
                              onChange={(e) => seekPlayback(Number(e.target.value))}
                              aria-label="Seek within recording"
                              className="flex-1 h-[3px] cursor-pointer" style={{ accentColor: 'var(--rt-accent)' }} />
                            <span className="text-[9px] font-mono tabular-nums w-[34px]" style={{ color: 'var(--rt-muted)' }}>
                              {formatDuration(Math.floor(playbackDuration))}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 justify-center flex-wrap">
                            <button type="button" onClick={() => skipRecording(-1)} title="Previous recording" aria-label="Previous recording" className="p-0.5" style={{ color: 'var(--rt-muted)' }}><SkipBack style={{ width: 10, height: 10 }} /></button>
                            <button type="button" onClick={() => seekPlayback(Math.max(0, playbackTime - 5))} title="Back 5s" aria-label="Back 5 seconds" className="p-0.5" style={{ color: 'var(--rt-muted)' }}><Rewind style={{ width: 10, height: 10 }} /></button>
                            {PLAYBACK_SPEEDS.map(s => (
                              <button key={s} type="button" onClick={() => changeSpeed(s)} className="text-[8px] font-mono font-bold px-1"
                                style={{ color: playbackSpeed === s ? 'var(--rt-accent)' : 'var(--rt-muted)', textDecoration: playbackSpeed === s ? 'underline' : 'none' }}>{s}×</button>
                            ))}
                            <button type="button" onClick={() => seekPlayback(Math.min(playbackDuration, playbackTime + 5))} title="Forward 5s" aria-label="Forward 5 seconds" className="p-0.5" style={{ color: 'var(--rt-muted)' }}><FastForward style={{ width: 10, height: 10 }} /></button>
                            <button type="button" onClick={() => skipRecording(1)} title="Next recording" aria-label="Next recording" className="p-0.5" style={{ color: 'var(--rt-muted)' }}><SkipForward style={{ width: 10, height: 10 }} /></button>
                            <button type="button" onClick={() => setLoopRecording(v => !v)} title="Loop" aria-label="Loop" className="p-0.5" style={{ color: loopRecording ? 'var(--rt-accent)' : 'var(--rt-muted)' }}><Repeat style={{ width: 10, height: 10 }} /></button>
                            <span className="text-[8px] font-mono tracking-wider ml-1" style={{ color: 'var(--rt-muted)' }}>VOL</span>
                            <input type="range" min={0} max={100} value={playbackVolume} onChange={(e) => setPlaybackVolume(Number(e.target.value))}
                              aria-label="Playback volume" className="w-12 h-[3px] cursor-pointer" style={{ accentColor: 'var(--rt-accent)' }} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* CSS */}
      <style>{`
        .radio-ptt-btn { border-radius: 50% !important; }
        @keyframes radioWave { 0% { height: 4px; } 100% { height: 22px; } }
        @keyframes radioPulse { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.35); opacity: 0; } }
        @keyframes incomingCallPulse { 0%, 100% { background: rgba(34,197,94,0.18); } 50% { background: rgba(34,197,94,0.32); } }
        @keyframes flashFade { 0% { opacity: 1; } 100% { opacity: 0; } }
        @media print {
          .radio-ptt-btn, header, aside { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Sub-components
// ════════════════════════════════════════════════════════════

function Sep() { return <span className="text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>│</span>; }

function Banner({ icon, color, bg, children }: { icon: React.ReactNode; color: string; bg: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: bg, borderBottom: `1px solid ${color}66` }}>
      {icon}
      <div className="flex-1 text-[10px] font-mono flex items-center gap-2">{children}</div>
    </div>
  );
}

function ToolbarBtn({ children, onClick, active, danger, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean; title?: string }) {
  const fg = danger ? '#ef4444' : active ? 'var(--rt-accent)' : 'var(--rt-muted)';
  const bg = active ? 'rgba(212,160,23,0.10)' : 'transparent';
  return (
    <button type="button" onClick={onClick} title={title}
      className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-bold tracking-wider"
      style={{ border: `1px solid ${active ? fg : 'var(--rt-border)'}`, color: fg, background: bg }}>
      {children}
    </button>
  );
}

function MiniToggle({ children, onClick, active, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className="flex items-center justify-center w-5 h-5"
      style={{
        border: `1px solid ${active ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
        color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
        background: active ? 'rgba(212,160,23,0.1)' : 'transparent',
      }}>
      {children}
    </button>
  );
}

function ModeToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono font-bold tracking-wider"
      style={{
        border: `1px solid ${active ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
        color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
        background: active ? 'rgba(212,160,23,0.08)' : 'transparent',
      }}>
      {icon} {label}
    </button>
  );
}

function FilterChip({ children, onClick, active, icon }: { children: React.ReactNode; onClick: () => void; active?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono font-bold tracking-wider"
      style={{
        border: `1px solid ${active ? 'var(--rt-accent)' : 'var(--rt-border)'}`,
        color: active ? 'var(--rt-accent)' : 'var(--rt-muted)',
        background: active ? 'rgba(212,160,23,0.08)' : 'transparent',
      }}>
      {icon}{children}
    </button>
  );
}

function SectionHeader({ icon, label, trailing }: { icon: React.ReactNode; label: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
      style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)', borderBottom: '1px solid var(--rt-border)' }}>
      {icon}
      <span className="text-[9px] font-mono font-bold tracking-[0.2em] flex-1 truncate" style={{ color: 'var(--rt-text)' }}>{label}</span>
      {trailing}
    </div>
  );
}

function Waveform({ color, reverse = false, reduceMotion = false }: { color: string; reverse?: boolean; reduceMotion?: boolean }) {
  const bars = reverse ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className="flex items-end gap-0.5 h-6">
      {bars.map(i => (
        <div key={i} className="w-1"
          style={{
            background: color,
            height: reduceMotion ? '12px' : undefined,
            animation: reduceMotion ? 'none' : `radioWave 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
          }} />
      ))}
    </div>
  );
}

function EmptyConsole({ isConnected, channels }: { isConnected: boolean; channels: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4 text-center">
      <div className="w-24 h-24 flex items-center justify-center"
        style={{ background: 'radial-gradient(circle at 30% 30%, #1a1a1a 0%, #0a0a0a 70%)', border: '3px solid var(--rt-border)', boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.6)', borderRadius: '50%' }}>
        <Antenna style={{ width: 36, height: 36, color: '#333' }} />
      </div>
      <div>
        <div className="text-sm font-mono font-bold tracking-[0.3em]" style={{ color: 'var(--rt-text)' }}>NO CHANNEL JOINED</div>
        <div className="text-[10px] font-mono mt-1 tracking-wider" style={{ color: 'var(--rt-muted)' }}>
          {channels} channel{channels === 1 ? '' : 's'} available — pick one from the left to begin
        </div>
      </div>
      {!isConnected && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono text-red-400" style={{ border: '1px solid #7f1d1d', background: 'rgba(127,29,29,0.15)' }}>
          <WifiOff style={{ width: 12, height: 12 }} />
          DISCONNECTED — Radio service unavailable
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-1.5" style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)' }}>
      <div className="text-[8px] font-mono tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>{label}</div>
      <div className="text-base font-mono font-bold tabular-nums leading-tight" style={{ color: 'var(--rt-text)' }}>{value}</div>
    </div>
  );
}

function Sparkline({ values, highlight }: { values: number[]; highlight?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-px h-8 px-2 py-1" style={{ background: '#0a0a0a', border: '1px solid var(--rt-border)' }}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * 100);
        const isNow = i === highlight;
        return (
          <div key={i} className="flex-1" title={`${i.toString().padStart(2, '0')}:00 — ${v} tx`}
            style={{ height: `${h}%`, background: isNow ? 'var(--rt-accent)' : v === 0 ? '#1a1a1a' : '#2a8a2a', boxShadow: isNow ? '0 0 4px var(--rt-accent)' : 'none' }} />
        );
      })}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 text-[9px] font-mono font-bold" style={{ background: '#1a1a1a', border: '1px solid #333', color: 'var(--rt-text)' }}>
      {children}
    </kbd>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 justify-between">
      <span className="text-[10px] tracking-wider" style={{ color: 'var(--rt-muted)' }}>{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function SettingCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 justify-between cursor-pointer">
      <span className="text-[10px] tracking-wider" style={{ color: 'var(--rt-muted)' }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="cursor-pointer" style={{ accentColor: 'var(--rt-accent)' }} />
    </label>
  );
}
