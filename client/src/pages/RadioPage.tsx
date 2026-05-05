import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Radio, Mic, MicOff, Users, Volume2, VolumeX, AlertCircle, WifiOff, ShieldAlert,
  Search, Download, Phone, PhoneOff, PhoneCall, PhoneIncoming, Play, Square,
  Antenna, Activity, ScanLine, LogOut, Star, Bell, BellOff, Volume1, Pause,
  Send, Bookmark, BookmarkCheck, Filter, X, Clock, BarChart3, TrendingUp,
  Megaphone, Hash, Type, Printer, FileJson, Maximize2, Minimize2, RefreshCw,
  Rewind, FastForward, Trash2, Save,
} from 'lucide-react';
import { useRadio } from '../hooks/useRadio';
import { usePrivateCall } from '../hooks/usePrivateCall';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import { localToday, safeTimeStr } from '../utils/dateUtils';

// ============================================================
// RMPG Flex — RadioPage (v3 — full-feature operator console)
// ============================================================

// ── Static reference data ─────────────────────────────────
const TEN_CODES: { code: string; meaning: string }[] = [
  { code: '10-1', meaning: 'Receiving poorly' },
  { code: '10-2', meaning: 'Receiving well' },
  { code: '10-4', meaning: 'Acknowledged' },
  { code: '10-6', meaning: 'Busy' },
  { code: '10-7', meaning: 'Out of service' },
  { code: '10-8', meaning: 'In service' },
  { code: '10-9', meaning: 'Repeat' },
  { code: '10-10', meaning: 'Off duty' },
  { code: '10-13', meaning: 'Weather/road' },
  { code: '10-15', meaning: 'Prisoner in custody' },
  { code: '10-19', meaning: 'Return to station' },
  { code: '10-20', meaning: 'Location' },
  { code: '10-22', meaning: 'Disregard' },
  { code: '10-23', meaning: 'Stand by' },
  { code: '10-25', meaning: 'Meet' },
  { code: '10-27', meaning: 'License check' },
  { code: '10-28', meaning: 'Registration check' },
  { code: '10-29', meaning: 'Wanted check' },
  { code: '10-32', meaning: 'Person w/ weapon' },
  { code: '10-33', meaning: 'EMERGENCY' },
  { code: '10-50', meaning: 'Accident' },
  { code: '10-76', meaning: 'En route' },
  { code: '10-97', meaning: 'On scene' },
  { code: '10-98', meaning: 'Available' },
];

const PHONETIC: Record<string, string> = {
  A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo',
  F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet',
  K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar',
  P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
  U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};

const STATUS_QUICKSET: { code: string; label: string; color: string }[] = [
  { code: '10-8', label: 'IN SVC',    color: '#22c55e' },
  { code: '10-7', label: 'OUT SVC',   color: '#ef4444' },
  { code: '10-19', label: 'STATION',  color: '#888888' },
  { code: '10-23', label: 'STAND BY', color: '#d4a017' },
  { code: '10-76', label: 'EN ROUTE', color: '#3b82f6' },
  { code: '10-97', label: 'ON SCENE', color: '#a855f7' },
];

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ── Local-storage helpers ─────────────────────────────────
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ok */ } },
  getSet: (k: string): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } },
  setSet: (k: string, v: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...v])); } catch { /* ok */ } },
  getMap: <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  setMap: (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ok */ } },
};

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

  // ════ Persistent UI state (localStorage-backed) ════════
  const [favorites, setFavorites] = useState<Set<string>>(() => ls.getSet('radio_favorites'));
  const [mutedChans, setMutedChans] = useState<Set<string>>(() => ls.getSet('radio_muted_channels'));
  const [chanVolumes, setChanVolumes] = useState<Record<string, number>>(() => ls.getMap('radio_channel_volumes', {} as Record<string, number>));
  const [notifEnabled, setNotifEnabled] = useState<boolean>(() => ls.get('radio_notif_enabled') === '1');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => ls.get('radio_sound_enabled') !== '0');
  const [autoScrollLock, setAutoScrollLock] = useState<boolean>(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(() => ls.getSet('radio_marked_tx'));
  const [savedSearches, setSavedSearches] = useState<string[]>(() => ls.getMap<string[]>('radio_saved_searches', []));
  const [compactMode, setCompactMode] = useState<boolean>(() => ls.get('radio_compact') === '1');
  const [time24h, setTime24h] = useState<boolean>(() => ls.get('radio_time_24h') !== '0');
  const [showRelative, setShowRelative] = useState<boolean>(() => ls.get('radio_time_relative') === '1');
  const [silenceAlertMin, setSilenceAlertMin] = useState<number>(() => parseInt(ls.get('radio_silence_alert') || '0', 10));
  const [currentStatus, setCurrentStatus] = useState<string | null>(() => ls.get('radio_current_status'));

  // ════ Ephemeral UI state ═══════════════════════════════
  const [pageMessage, setPageMessage] = useState('');
  const [pageRecipient, setPageRecipient] = useState('');
  const [phoneticInput, setPhoneticInput] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [filterUserId, setFilterUserId] = useState<number | null>(null);
  const [txTimer, setTxTimer] = useState(0);
  const [showCodes, setShowCodes] = useState(true);
  const [showPhonetic, setShowPhonetic] = useState(true);

  // Persist
  useEffect(() => { ls.setSet('radio_favorites', favorites); }, [favorites]);
  useEffect(() => { ls.setSet('radio_muted_channels', mutedChans); }, [mutedChans]);
  useEffect(() => { ls.setMap('radio_channel_volumes', chanVolumes); }, [chanVolumes]);
  useEffect(() => { ls.set('radio_notif_enabled', notifEnabled ? '1' : '0'); }, [notifEnabled]);
  useEffect(() => { ls.set('radio_sound_enabled', soundEnabled ? '1' : '0'); }, [soundEnabled]);
  useEffect(() => { ls.setSet('radio_marked_tx', markedIds); }, [markedIds]);
  useEffect(() => { ls.setMap('radio_saved_searches', savedSearches); }, [savedSearches]);
  useEffect(() => { ls.set('radio_compact', compactMode ? '1' : '0'); }, [compactMode]);
  useEffect(() => { ls.set('radio_time_24h', time24h ? '1' : '0'); }, [time24h]);
  useEffect(() => { ls.set('radio_time_relative', showRelative ? '1' : '0'); }, [showRelative]);
  useEffect(() => { ls.set('radio_silence_alert', String(silenceAlertMin)); }, [silenceAlertMin]);
  useEffect(() => { if (currentStatus) ls.set('radio_current_status', currentStatus); }, [currentStatus]);

  // ── Sorted channel list (favorites first) ────────────
  const sortedChannels = useMemo(() => {
    return [...RADIO_CHANNELS].sort((a, b) => {
      const aFav = favorites.has(a.id) ? 1 : 0;
      const bFav = favorites.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return 0;
    });
  }, [RADIO_CHANNELS, favorites]);

  // ── Channel ops ──────────────────────────────────────
  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleMuteChan = (id: string) => {
    setMutedChans(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const setChanVolume = (id: string, v: number) => {
    setChanVolumes(prev => ({ ...prev, [id]: v }));
  };

  // ── Keyboard PTT + global shortcuts ──────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isInput) return;
      if (isInCall) return;

      // PTT
      if (currentChannel && (e.code === 'Space' || e.key === 'F5' || e.keyCode === 279) && !spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = true;
        startTransmit();
        return;
      }
      // Shortcuts
      if (e.key === 'm') { setSoundEnabled(s => !s); }
      if (e.key === 'c') { setCompactMode(s => !s); }
      if (e.key === 'l') { setAutoScrollLock(s => !s); }
      if (e.key === 's' && currentChannel) {
        if (scanActive) stopScan();
        else startScan(RADIO_CHANNELS.filter(c => c.id !== currentChannel).map(c => c.id));
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === 'F5' || e.keyCode === 279) && spaceHeldRef.current) {
        e.preventDefault();
        spaceHeldRef.current = false;
        stopTransmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [currentChannel, startTransmit, stopTransmit, isInCall, scanActive, startScan, stopScan, RADIO_CHANNELS]);

  // ── TX timer (counts up while transmitting) ──────────
  useEffect(() => {
    if (!isTransmitting) { setTxTimer(0); return; }
    const start = Date.now();
    const t = setInterval(() => setTxTimer(Math.floor((Date.now() - start) / 1000)), 200);
    return () => clearInterval(t);
  }, [isTransmitting]);

  const channelInfo = RADIO_CHANNELS.find(c => c.id === currentChannel);
  const otherSpeaking = activeSpeaker && activeSpeaker.userId !== Number(user?.id);

  // ════ History fetch + filter ═══════════════════════════
  const [historyEntries, setHistoryEntries] = useState<any[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [historyChannel, setHistoryChannel] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (historyChannel) params.set('channel', historyChannel);
      if (historySearch) params.set('search', historySearch);
      const result = await apiFetch<{ data: any[]; total: number }>(`/comms/radio/transcripts?${params.toString()}`);
      setHistoryEntries(result.data || []);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyChannel, historySearch]);

  useLiveSync('dispatch', fetchHistory);
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const filteredHistory = useMemo(() => {
    if (!filterUserId) return historyEntries;
    return historyEntries.filter(e => Number(e.user_id) === filterUserId);
  }, [historyEntries, filterUserId]);

  // ════ Stats (computed from history) ════════════════════
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
      cur.count += 1;
      cur.sec += Number(e.duration) || 0;
      byUser.set(k, cur);
    });
    const top = [...byUser.values()].sort((a, b) => b.count - a.count).slice(0, 5);

    // Per-channel TX count today
    const byChan = new Map<string, number>();
    todayEntries.forEach(e => {
      byChan.set(e.channel, (byChan.get(e.channel) || 0) + 1);
    });

    // Hourly bins (24)
    const hourly = new Array(24).fill(0);
    todayEntries.forEach(e => {
      try {
        const h = new Date(e.transmitted_at).getHours();
        if (h >= 0 && h < 24) hourly[h] += 1;
      } catch { /* ignore */ }
    });

    return {
      myTxCount: myToday.length,
      myAirSec,
      allTxCount: todayEntries.length,
      allAirSec,
      top,
      byChan,
      hourly,
    };
  }, [historyEntries, user]);

  // ════ Audio Playback (with speed control) ══════════════
  const [playingId, setPlayingId] = useState<string | number | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
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

  const startPlaybackAt = useCallback((buffer: AudioBuffer, offset: number, speed: number, entryId: any, knownDur: number) => {
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
    source.connect(ctx.destination);
    source.onended = () => {
      if (audioSourceRef.current === source) stopPlaybackInternal();
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
  }, [stopPlaybackInternal]);

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
      startPlaybackAt(audioBuffer, 0, playbackSpeed, entryId, serverDur);
    } catch (err: any) {
      console.error('[Radio Playback] Failed:', err);
      addToast(`Playback failed: ${err?.name || 'Error'} — ${(err?.message || '').slice(0, 100)}`, 'error');
      stopPlaybackInternal();
    }
  }, [playingId, addToast, stopPlaybackInternal, startPlaybackAt, playbackSpeed]);

  const seekPlayback = useCallback((seconds: number) => {
    const buffer = playbackBufferRef.current;
    if (!audioCtxRef.current || !buffer || playingId == null) return;
    const clamped = Math.max(0, Math.min(seconds, buffer.duration));
    startPlaybackAt(buffer, clamped, playbackRateRef.current, playingId, buffer.duration);
  }, [playingId, startPlaybackAt]);

  const changeSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    const buffer = playbackBufferRef.current;
    if (!audioCtxRef.current || !buffer || playingId == null) return;
    const elapsed = (audioCtxRef.current.currentTime - playbackStartCtxTimeRef.current) * playbackRateRef.current + playbackOffsetRef.current;
    startPlaybackAt(buffer, Math.min(elapsed, buffer.duration), speed, playingId, buffer.duration);
  }, [playingId, startPlaybackAt]);

  const downloadRecording = useCallback(async (entry: any) => {
    try {
      const rawBlob = await apiFetchBlob(`/comms/radio/audio/${entry.id}`);
      const blob = rawBlob.type.startsWith('audio/') ? rawBlob : new Blob([rawBlob], { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const ts = (entry.transmitted_at || '').replace(/[:\s]/g, '-');
      const who = (entry.username || 'unit').replace(/[^a-z0-9_-]/gi, '');
      const chan = (entry.channel || 'radio').replace(/[^a-z0-9_-]/gi, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `radio-${chan}-${who}-${ts}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { addToast('Failed to download recording', 'error'); }
  }, [addToast]);

  useEffect(() => () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch { /* ok */ }
      try { audioSourceRef.current.disconnect(); } catch { /* ok */ }
    }
    if (playbackTimerRef.current) clearInterval(playbackTimerRef.current);
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') audioCtxRef.current.close().catch(() => {});
  }, []);

  // ════ Notifications + sound on new TX ══════════════════
  const lastNotifIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (transmissionLog.length === 0) return;
    const latest = transmissionLog[transmissionLog.length - 1];
    if (latest.id === lastNotifIdRef.current) return;
    if (Number(latest.userId) === Number(user?.id)) { lastNotifIdRef.current = latest.id; return; }
    lastNotifIdRef.current = latest.id;
    if (mutedChans.has(latest.channel)) return;
    if (soundEnabled) playBeep();
    if (notifEnabled && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`Radio: ${latest.fullName || latest.username}`, {
          body: `${latest.channel.toUpperCase()}${latest.transcript ? ' — ' + latest.transcript.slice(0, 80) : ''}`,
          tag: 'rmpg-radio',
        });
      } catch { /* ok */ }
    }
  }, [transmissionLog, soundEnabled, notifEnabled, mutedChans, user]);

  const enableNotifications = async () => {
    if (!('Notification' in window)) { addToast('Notifications not supported', 'error'); return; }
    if (Notification.permission === 'granted') { setNotifEnabled(v => !v); return; }
    const p = await Notification.requestPermission();
    setNotifEnabled(p === 'granted');
  };

  // ════ Silence alert (notify if channel quiet for X mins) ════
  const lastTrafficRef = useRef<number>(Date.now());
  useEffect(() => { lastTrafficRef.current = Date.now(); }, [transmissionLog.length, activeSpeaker]);
  useEffect(() => {
    if (!silenceAlertMin || !currentChannel) return;
    const t = setInterval(() => {
      const quietMs = Date.now() - lastTrafficRef.current;
      if (quietMs > silenceAlertMin * 60 * 1000) {
        addToast(`Channel quiet for ${silenceAlertMin}m — silence alert`, 'info');
        lastTrafficRef.current = Date.now();
      }
    }, 30000);
    return () => clearInterval(t);
  }, [silenceAlertMin, currentChannel, addToast]);

  // ════ Format helpers ═══════════════════════════════════
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

  // ════ Page composer ════════════════════════════════════
  const sendQuickPage = (msg: string, recipient?: string) => {
    if (!currentChannel) { addToast('Join a channel first', 'error'); return; }
    try {
      sendPage(recipient || '', msg);
      addToast(`Page sent: ${msg.slice(0, 40)}`, 'success');
      setPageMessage('');
    } catch { addToast('Page failed', 'error'); }
  };

  const broadcastStatus = (code: string, label: string) => {
    setCurrentStatus(`${code} ${label}`);
    sendQuickPage(`STATUS: ${code} ${label}`);
  };

  const radioCheck = () => sendQuickPage('RADIO CHECK — please ack');

  // ════ Mark / unmark TX ═════════════════════════════════
  const toggleMark = (id: string) => {
    setMarkedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ════ Search ═══════════════════════════════════════════
  const saveCurrentSearch = () => {
    if (!historySearch.trim()) return;
    if (savedSearches.includes(historySearch.trim())) return;
    setSavedSearches(prev => [historySearch.trim(), ...prev].slice(0, 10));
  };
  const removeSavedSearch = (q: string) => setSavedSearches(prev => prev.filter(s => s !== q));

  // Highlight matches
  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const terms = q.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
    if (terms.length === 0) return text;
    const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    const parts = text.split(re);
    return parts.map((p, i) => re.test(p)
      ? <mark key={i} style={{ background: '#d4a01755', color: '#fff' }}>{p}</mark>
      : <span key={i}>{p}</span>);
  };

  // ════ Last TX replay ═══════════════════════════════════
  const replayLastTx = () => {
    const last = filteredHistory.find(e => e.audio_file);
    if (!last) { addToast('No replayable transmission', 'info'); return; }
    togglePlayback(last);
  };

  // ════ Export / print ═══════════════════════════════════
  const exportHistoryCsv = () => {
    if (filteredHistory.length === 0) return;
    const header = 'Timestamp,Channel,User,Duration(s),Transcript,Marked,HasAudio\n';
    const rows = filteredHistory.map(e =>
      `"${e.transmitted_at}","${e.channel}","${e.full_name || e.username || ''}","${e.duration || ''}","${(e.transcript || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}","${markedIds.has(String(e.id)) ? 'Y' : ''}","${e.audio_file ? 'Y' : ''}"`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `radio-transcripts-${localToday()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  const exportHistoryJson = () => {
    if (filteredHistory.length === 0) return;
    const blob = new Blob([JSON.stringify(filteredHistory, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `radio-transcripts-${localToday()}.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  const printHistory = () => window.print();

  useEffect(() => { document.title = 'Radio Communications — RMPG Flex'; }, []);

  // ────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────
  const cm = compactMode; // shorthand

  return (
    <div className="h-full flex flex-col" style={{ background: '#0a0a0a' }}>

      {/* ─── Banner stack ─── */}
      {!micSupported && (
        <Banner color="#ef4444" bg="rgba(220,38,38,0.15)" icon={<ShieldAlert style={{ width: 14, height: 14, color: '#ef4444' }} />}>
          <span className="font-bold text-red-400">SECURE CONNECTION REQUIRED</span>
          <span className="text-rmpg-400 ml-2">Microphone needs HTTPS — listening only.</span>
        </Banner>
      )}

      {panicAlert && (
        <div className="flex items-center gap-3 px-4 py-2 animate-pulse" style={{ background: 'rgba(239,68,68,0.25)', borderBottom: '2px solid #ef4444' }}>
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
        <Banner color="#aaa" bg="rgba(136,136,136,0.1)" icon={<Phone style={{ width: 12, height: 12, color: '#aaa', animation: 'radioPulse 1.5s ease infinite' }} />}>
          <span className="text-gray-300">Calling <strong>{ringingTarget.name}</strong>…</span>
          <button type="button" onClick={endCall} className="ml-auto text-[10px] font-mono text-red-400 px-2 py-0.5" style={{ border: '1px solid #ef4444' }}>CANCEL</button>
        </Banner>
      )}

      {incomingCall && (
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'rgba(34,197,94,0.18)', borderBottom: '2px solid #22c55e', animation: 'incomingCallPulse 2s ease-in-out infinite' }}>
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
        style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #111 100%)', borderBottom: '1px solid #2b2b2b' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Antenna style={{ width: 14, height: 14, color: '#d4a017' }} />
            <span className="text-[11px] font-mono font-bold tracking-[0.2em] text-white">RMPG RADIO</span>
          </div>
          <Sep />
          <div className="flex items-center gap-1.5">
            <span className="led-dot" style={{ background: isConnected ? '#22c55e' : '#ef4444', boxShadow: `0 0 4px ${isConnected ? '#22c55e' : '#ef4444'}` }} />
            <span className="text-[10px] font-mono tracking-wider" style={{ color: isConnected ? '#22c55e' : '#ef4444' }}>
              {isConnected ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
          {currentChannel && channelInfo && (
            <>
              <Sep />
              <span className="text-[10px] font-mono text-rmpg-500">CH</span>
              <span className="text-[11px] font-mono font-bold text-white tracking-wider">{channelInfo.label}</span>
              <span className="text-[10px] font-mono text-rmpg-500">{channelInfo.freq} MHz</span>
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
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <ToolbarBtn onClick={enableNotifications} active={notifEnabled} title="Browser notifications (toggle)">
            {notifEnabled ? <Bell style={{ width: 11, height: 11 }} /> : <BellOff style={{ width: 11, height: 11 }} />}
            NOTIF
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setSoundEnabled(v => !v)} active={soundEnabled} title="Beep on new TX (M)">
            {soundEnabled ? <Volume1 style={{ width: 11, height: 11 }} /> : <VolumeX style={{ width: 11, height: 11 }} />}
            SOUND
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setCompactMode(v => !v)} active={cm} title="Compact mode (C)">
            {cm ? <Maximize2 style={{ width: 11, height: 11 }} /> : <Minimize2 style={{ width: 11, height: 11 }} />}
            {cm ? 'NORMAL' : 'COMPACT'}
          </ToolbarBtn>
          <ToolbarBtn onClick={() => setTime24h(v => !v)} title="12h / 24h time">
            <Clock style={{ width: 11, height: 11 }} />
            {time24h ? '24H' : '12H'}
          </ToolbarBtn>
          {currentChannel && (
            <>
              <ToolbarBtn
                onClick={() => {
                  if (scanActive) stopScan();
                  else startScan(RADIO_CHANNELS.filter(c => c.id !== currentChannel).map(c => c.id));
                }}
                active={scanActive}
                title="Scan other channels (S)"
              >
                <ScanLine style={{ width: 11, height: 11 }} />
                {scanActive ? 'SCAN ON' : 'SCAN'}
              </ToolbarBtn>
              <ToolbarBtn onClick={leaveChannel} danger title="Leave current channel">
                <LogOut style={{ width: 11, height: 11 }} />
                LEAVE
              </ToolbarBtn>
            </>
          )}
        </div>
      </div>

      {/* ═════════════ MAIN GRID ═════════════ */}
      <div
        className="flex-1 grid grid-cols-1 overflow-hidden"
        style={{
          gridTemplateColumns: cm
            ? 'minmax(0, 1fr)'
            : '220px minmax(0, 1fr) 380px',
        }}
      >

        {/* ── LEFT COLUMN ──────────────────────────────── */}
        {!cm && (
          <aside className="flex flex-col overflow-hidden" style={{ background: '#0d0d0d', borderRight: '1px solid #1f1f1f' }}>
            <div className="flex-1 overflow-y-auto">

              {/* CHANNELS */}
              <SectionHeader icon={<Radio style={{ width: 11, height: 11, color: '#d4a017' }} />} label={`CHANNELS · ${RADIO_CHANNELS.length}`} />
              <div className="px-1 py-1.5 space-y-0.5">
                {sortedChannels.map((ch) => {
                  const isActive = ch.id === currentChannel;
                  const isFav = favorites.has(ch.id);
                  const isMuted = mutedChans.has(ch.id);
                  const vol = chanVolumes[ch.id] ?? 100;
                  const txCount = stats.byChan.get(ch.id) || 0;
                  return (
                    <div
                      key={ch.id}
                      className="group"
                      style={{
                        background: isActive ? 'linear-gradient(90deg, rgba(212,160,23,0.18), transparent)' : 'transparent',
                        borderLeft: isActive ? '2px solid #d4a017' : '2px solid transparent',
                      }}
                    >
                      <div className="flex items-center gap-1.5 px-1.5 py-1">
                        <button
                          type="button"
                          onClick={() => toggleFavorite(ch.id)}
                          aria-label={isFav ? 'Unfavorite' : 'Favorite'}
                          title={isFav ? 'Unfavorite' : 'Favorite'}
                          className="p-0.5"
                        >
                          <Star style={{ width: 10, height: 10, color: isFav ? '#d4a017' : '#444', fill: isFav ? '#d4a017' : 'none' }} />
                        </button>
                        <button
                          type="button"
                          onClick={() => joinChannel(ch.id)}
                          disabled={!isConnected}
                          className="flex-1 flex items-center gap-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span className="led-dot" style={{
                            background: isActive ? (channelBusy ? '#ef4444' : '#22c55e') : '#333',
                            boxShadow: isActive ? `0 0 4px ${channelBusy ? '#ef4444' : '#22c55e'}` : 'none',
                            animation: isActive && channelBusy ? 'radioPulse 1s ease-in-out infinite' : 'none',
                          }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-mono font-bold tracking-wider truncate" style={{ color: isActive ? '#fff' : isMuted ? '#555' : '#aaa' }}>
                              {ch.label}
                            </div>
                            <div className="text-[8px] font-mono flex items-center gap-1.5" style={{ color: isActive ? '#d4a01799' : '#555' }}>
                              <span>{ch.freq}</span>
                              {txCount > 0 && <span className="text-[#d4a017]">· {txCount} tx</span>}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMuteChan(ch.id)}
                          aria-label={isMuted ? 'Unmute channel' : 'Mute channel'}
                          title={isMuted ? 'Unmute' : 'Mute'}
                          className="p-0.5"
                        >
                          {isMuted ? <VolumeX style={{ width: 10, height: 10, color: '#ef4444' }} /> : <Volume2 style={{ width: 10, height: 10, color: '#444' }} />}
                        </button>
                      </div>
                      {isActive && (
                        <div className="flex items-center gap-1.5 px-2 pb-1.5">
                          <Volume1 style={{ width: 9, height: 9, color: '#666' }} />
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={vol}
                            onChange={(e) => setChanVolume(ch.id, Number(e.target.value))}
                            aria-label={`Volume for ${ch.label}`}
                            className="flex-1 h-[3px] accent-[#d4a017] bg-[#222] cursor-pointer"
                          />
                          <span className="text-[8px] font-mono text-rmpg-500 tabular-nums w-[24px] text-right">{vol}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* STATUS QUICKSET */}
              <SectionHeader icon={<Hash style={{ width: 11, height: 11, color: '#d4a017' }} />} label="STATUS · SET" />
              <div className="px-2 py-2 grid grid-cols-2 gap-1">
                {STATUS_QUICKSET.map(s => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => broadcastStatus(s.code, s.label)}
                    disabled={!currentChannel}
                    className="flex flex-col items-center justify-center px-1 py-1.5 text-[9px] font-mono font-bold tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ border: `1px solid ${s.color}33`, color: s.color, background: 'transparent' }}
                    title={`Broadcast status: ${s.code} ${s.label}`}
                    onMouseEnter={(e) => { if (currentChannel) e.currentTarget.style.background = `${s.color}15`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 10 }}>{s.code}</span>
                    <span style={{ opacity: 0.7 }}>{s.label}</span>
                  </button>
                ))}
              </div>

              {/* 10-CODES */}
              <SectionHeader
                icon={<Hash style={{ width: 11, height: 11, color: '#d4a017' }} />}
                label="10-CODES"
                trailing={<button type="button" onClick={() => setShowCodes(v => !v)} aria-label="toggle 10-codes" className="text-rmpg-500 hover:text-white">
                  {showCodes ? <Minimize2 style={{ width: 9, height: 9 }} /> : <Maximize2 style={{ width: 9, height: 9 }} />}
                </button>}
              />
              {showCodes && (
                <div className="px-2 py-1.5 grid grid-cols-1 gap-px text-[9px] font-mono">
                  {TEN_CODES.map(c => (
                    <div key={c.code} className="flex justify-between gap-2 px-1 py-0.5 hover:bg-[#161616]">
                      <span className="text-[#d4a017] font-bold">{c.code}</span>
                      <span className="text-rmpg-400 truncate text-right">{c.meaning}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* PHONETIC */}
              <SectionHeader
                icon={<Type style={{ width: 11, height: 11, color: '#d4a017' }} />}
                label="PHONETIC"
                trailing={<button type="button" onClick={() => setShowPhonetic(v => !v)} aria-label="toggle phonetic" className="text-rmpg-500 hover:text-white">
                  {showPhonetic ? <Minimize2 style={{ width: 9, height: 9 }} /> : <Maximize2 style={{ width: 9, height: 9 }} />}
                </button>}
              />
              {showPhonetic && (
                <>
                  <div className="px-2 py-1.5">
                    <input
                      type="text"
                      value={phoneticInput}
                      onChange={(e) => setPhoneticInput(e.target.value)}
                      placeholder="Spell helper…"
                      aria-label="Spell helper"
                      className="w-full bg-[#0a0a0a] text-[10px] font-mono text-white px-2 py-1"
                      style={{ border: '1px solid #2a2a2a' }}
                    />
                    {phoneticInput && (
                      <div className="mt-1 text-[9px] font-mono text-[#d4a017] leading-relaxed break-words">
                        {phoneticInput.toUpperCase().split('').map(ch => PHONETIC[ch] || ch).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="px-2 pb-2 grid grid-cols-2 gap-px text-[9px] font-mono">
                    {Object.entries(PHONETIC).map(([k, v]) => (
                      <div key={k} className="flex gap-1.5 px-1 py-0.5 hover:bg-[#161616]">
                        <span className="text-[#d4a017] font-bold w-[10px]">{k}</span>
                        <span className="text-rmpg-400 truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        )}

        {/* ── CENTER COLUMN: Console ────────────────────── */}
        <main
          className="flex flex-col overflow-y-auto"
          style={{ background: 'radial-gradient(ellipse at center top, #131313 0%, #0a0a0a 60%)' }}
        >
          {!currentChannel ? (
            <EmptyConsole isConnected={isConnected} channels={RADIO_CHANNELS.length} />
          ) : (
            <div className={`flex-1 flex flex-col items-center px-6 py-${cm ? '4' : '6'} gap-${cm ? '3' : '5'}`}>

              {/* CRT FREQUENCY DISPLAY */}
              <div
                className="w-full max-w-md p-5 text-center relative overflow-hidden"
                style={{
                  background: 'linear-gradient(180deg, #050a05 0%, #020602 100%)',
                  border: '2px solid #1a2a1a',
                  boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.7), 0 0 30px rgba(51,255,51,0.04)',
                }}
              >
                {/* CRT scanlines */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.2) 3px, rgba(0,0,0,0.2) 3px)',
                  mixBlendMode: 'multiply',
                }} />
                <div className="absolute top-1.5 left-2 text-[8px] font-mono tracking-[0.3em]" style={{ color: '#1a5a1a' }}>
                  ◉ ON AIR
                </div>
                <div className="absolute top-1.5 right-2 text-[8px] font-mono tracking-[0.3em]" style={{ color: '#1a5a1a' }}>
                  CH-{(RADIO_CHANNELS.findIndex(c => c.id === currentChannel) + 1).toString().padStart(2, '0')}
                </div>
                <div className="text-[9px] font-mono tracking-[0.4em] mt-1 relative" style={{ color: '#1a5a1a' }}>
                  CHANNEL
                </div>
                <div
                  className="text-4xl font-bold font-mono tracking-[0.15em] mt-1 relative"
                  style={{ color: '#33ff33', textShadow: '0 0 12px rgba(51, 255, 51, 0.5)' }}
                >
                  {channelInfo?.label || currentChannel.toUpperCase()}
                </div>
                <div className="text-base font-mono mt-2 tracking-widest relative" style={{ color: '#33ff33', opacity: 0.55 }}>
                  {channelInfo?.freq || '---'} MHz
                </div>
                <div className="mt-3 pt-2 border-t border-[#0c1c0c] text-[9px] font-mono tracking-[0.3em] relative"
                  style={{ color: activeSpeaker ? '#ef4444' : isTransmitting ? '#ef4444' : '#1a5a1a' }}>
                  {isTransmitting ? `── TX · ${formatCallDuration(txTimer)} ──` : activeSpeaker ? '── TRAFFIC ──' : '── CHANNEL CLEAR ──'}
                </div>
              </div>

              {/* HOURLY ACTIVITY MICRO-SPARKLINE */}
              <div className="w-full max-w-md">
                <Sparkline values={stats.hourly} highlight={new Date().getHours()} />
              </div>

              {/* ACTIVE SPEAKER */}
              <div className="w-full max-w-md min-h-[56px] flex items-center justify-center">
                {activeSpeaker ? (
                  <div className="flex items-center justify-center gap-4 w-full px-3 py-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)' }}>
                    <Waveform color="#ef4444" />
                    <div className="text-center">
                      <div className="text-sm font-bold font-mono text-red-400 tracking-wider">
                        {activeSpeaker.fullName || activeSpeaker.username || 'Unknown'}
                      </div>
                      <div className="text-[9px] font-mono text-red-400/70 tracking-[0.3em]">TRANSMITTING</div>
                    </div>
                    <Waveform color="#ef4444" reverse />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] font-mono tracking-[0.3em] text-rmpg-600">
                    <Activity style={{ width: 11, height: 11 }} />
                    STANDBY · NO TRAFFIC
                  </div>
                )}
              </div>

              {/* PTT BUTTON (round, fixed via CSS class !important) */}
              <button
                type="button"
                ref={pttRef}
                onMouseDown={() => startTransmit()}
                onMouseUp={() => stopTransmit()}
                onMouseLeave={() => { if (isTransmitting) stopTransmit(); }}
                onTouchStart={(e) => { e.preventDefault(); startTransmit(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopTransmit(); }}
                disabled={!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall}
                aria-label="Push to talk"
                className="radio-ptt-btn relative flex items-center justify-center select-none"
                style={{
                  width: cm ? 140 : 200,
                  height: cm ? 140 : 200,
                  background: isInCall
                    ? 'radial-gradient(circle at 30% 30%, #2b2b2b 0%, #141414 60%, #0c0c0c 100%)'
                    : !micSupported
                      ? 'radial-gradient(circle at 30% 30%, #2a2a2a 0%, #181818 60%, #0c0c0c 100%)'
                      : isTransmitting
                        ? 'radial-gradient(circle at 30% 30%, #ff5050 0%, #c41e1e 50%, #5a0a0a 100%)'
                        : otherSpeaking
                          ? 'radial-gradient(circle at 30% 30%, #d4a017 0%, #8a6810 60%, #3a2c06 100%)'
                          : 'radial-gradient(circle at 30% 30%, #33aa33 0%, #1e7a1e 50%, #0a3a0a 100%)',
                  border: isInCall ? '5px solid #88888880'
                    : !micSupported ? '5px solid #2a2a2a'
                    : isTransmitting ? '5px solid #ff6060'
                    : otherSpeaking ? '5px solid #d4a017' : '5px solid #2a8a2a',
                  boxShadow: isTransmitting
                    ? '0 0 40px rgba(255, 64, 64, 0.6), inset 0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 8px rgba(255,255,255,0.1)'
                    : otherSpeaking
                      ? '0 0 28px rgba(212, 160, 23, 0.4), inset 0 4px 12px rgba(0,0,0,0.5)'
                      : '0 0 24px rgba(34, 170, 34, 0.35), inset 0 4px 12px rgba(0,0,0,0.5), inset 0 -2px 8px rgba(255,255,255,0.08)',
                  cursor: (!isConnected || !micSupported || (channelBusy && !isTransmitting) || isInCall) ? 'not-allowed' : 'pointer',
                  opacity: (!isConnected || !micSupported || isInCall) ? 0.4 : 1,
                  transition: 'all 0.12s ease',
                  touchAction: 'none',
                  transform: isTransmitting ? 'scale(0.97)' : 'scale(1)',
                }}
              >
                {isTransmitting && (
                  <div className="absolute inset-[-12px] rounded-full pointer-events-none"
                    style={{ border: '2px solid rgba(255, 64, 64, 0.5)', animation: 'radioPulse 1.2s ease-out infinite' }} />
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
                {isInCall ? (
                  <span className="text-[10px] font-mono text-gray-400 tracking-wider">PTT DISABLED — PRIVATE CALL ACTIVE</span>
                ) : !micSupported ? (
                  <span className="text-[10px] font-mono text-rmpg-500 tracking-wider">HTTPS REQUIRED — LISTENING ONLY</span>
                ) : isTransmitting ? (
                  <span className="text-[10px] font-mono text-red-400 tracking-wider animate-pulse">▮ TRANSMITTING — RELEASE TO STOP</span>
                ) : otherSpeaking ? (
                  <span className="text-[10px] font-mono text-[#d4a017] tracking-wider">
                    {activeSpeaker?.fullName || activeSpeaker?.username || 'Unknown'} HAS THE FLOOR
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-rmpg-500 tracking-wider">
                    HOLD <Kbd>SPACE</Kbd> OR PTT TO TALK
                  </span>
                )}
              </div>

              {/* QUICK ACTIONS — radio check + replay last */}
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <button type="button" onClick={radioCheck} disabled={!currentChannel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider text-rmpg-300 hover:text-white disabled:opacity-30"
                  style={{ border: '1px solid #2e2e2e', background: '#141414' }}>
                  <RefreshCw style={{ width: 10, height: 10 }} /> RADIO CHECK
                </button>
                <button type="button" onClick={replayLastTx}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider text-rmpg-300 hover:text-white"
                  style={{ border: '1px solid #2e2e2e', background: '#141414' }}>
                  <Rewind style={{ width: 10, height: 10 }} /> REPLAY LAST
                </button>
                <button type="button" onClick={() => setSilenceAlertMin(silenceAlertMin === 0 ? 5 : 0)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold tracking-wider hover:text-white"
                  style={{ border: '1px solid #2e2e2e', background: '#141414', color: silenceAlertMin > 0 ? '#d4a017' : '#888' }}
                  title="Toggle silence-alert (5 min)">
                  <Bell style={{ width: 10, height: 10 }} /> SILENCE {silenceAlertMin > 0 ? `${silenceAlertMin}m` : 'OFF'}
                </button>
              </div>

              {/* PAGE COMPOSER */}
              <div className="w-full max-w-md" style={{ background: '#0d0d0d', border: '1px solid #1f1f1f' }}>
                <SectionHeader icon={<Megaphone style={{ width: 11, height: 11, color: '#d4a017' }} />} label="PAGE / TEXT COMPOSER" />
                <div className="p-2 space-y-2">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={pageRecipient}
                      onChange={(e) => setPageRecipient(e.target.value)}
                      placeholder="Call sign (optional)"
                      aria-label="Page recipient"
                      className="w-32 bg-[#0a0a0a] text-[10px] font-mono text-white px-2 py-1 placeholder:text-rmpg-600"
                      style={{ border: '1px solid #2a2a2a' }}
                    />
                    <input
                      type="text"
                      value={pageMessage}
                      onChange={(e) => setPageMessage(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && pageMessage) sendQuickPage(pageMessage, pageRecipient); }}
                      placeholder="Message…"
                      aria-label="Page message"
                      className="flex-1 bg-[#0a0a0a] text-[10px] font-mono text-white px-2 py-1 placeholder:text-rmpg-600"
                      style={{ border: '1px solid #2a2a2a' }}
                    />
                    <button type="button" onClick={() => sendQuickPage(pageMessage, pageRecipient)} disabled={!pageMessage || !currentChannel}
                      className="px-3 py-1 text-[10px] font-mono font-bold tracking-wider disabled:opacity-30"
                      style={{ background: '#d4a017', color: '#0a0a0a' }}>
                      <Send style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} /> SEND
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {['STAND BY', 'CODE 4', 'GO AHEAD', 'COPY', 'NEED BACKUP', 'CLEAR'].map(t => (
                      <button key={t} type="button" onClick={() => sendQuickPage(t, pageRecipient)}
                        disabled={!currentChannel}
                        className="text-[9px] font-mono px-1.5 py-0.5 disabled:opacity-30"
                        style={{ border: '1px solid #2a2a2a', color: '#888' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = '#d4a017'; e.currentTarget.style.borderColor = '#d4a01755'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = '#2a2a2a'; }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* SHORTCUTS / HELP — always visible inline */}
              <div className="w-full max-w-md text-[9px] font-mono text-rmpg-600 text-center leading-relaxed">
                SHORTCUTS · <Kbd>SPACE</Kbd> tx · <Kbd>S</Kbd> scan · <Kbd>M</Kbd> sound · <Kbd>C</Kbd> compact · <Kbd>L</Kbd> auto-scroll lock
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
          <aside className="flex flex-col overflow-hidden" style={{ background: '#0d0d0d', borderLeft: '1px solid #1f1f1f' }}>

            {/* Search bar */}
            <div className="flex-shrink-0 px-2 py-2 flex items-center gap-1.5 relative" style={{ background: 'linear-gradient(180deg, #181818, #141414)', borderBottom: '1px solid #1f1f1f' }}>
              <Search style={{ width: 11, height: 11, color: '#666' }} />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                onFocus={() => setShowSearchHistory(true)}
                onBlur={() => setTimeout(() => setShowSearchHistory(false), 150)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && historySearch.trim()) {
                    setSearchHistory(prev => [historySearch, ...prev.filter(s => s !== historySearch)].slice(0, 8));
                  }
                }}
                placeholder="Search transcripts… (multi-word)"
                aria-label="Search transcripts"
                className="flex-1 bg-transparent text-[10px] text-white font-mono focus:outline-none placeholder:text-rmpg-600 min-w-0"
              />
              <select
                value={historyChannel}
                onChange={(e) => setHistoryChannel(e.target.value)}
                aria-label="Filter by channel"
                className="bg-[#0a0a0a] text-[9px] text-rmpg-300 font-mono px-1 py-0.5"
                style={{ border: '1px solid #2a2a2a' }}
              >
                <option value="">ALL</option>
                {RADIO_CHANNELS.map(ch => <option key={ch.id} value={ch.id}>{ch.label}</option>)}
              </select>
              <button type="button" onClick={saveCurrentSearch} disabled={!historySearch.trim()} title="Save search" aria-label="Save search"
                className="p-1 text-rmpg-400 hover:text-[#d4a017] disabled:opacity-30">
                <Save style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={exportHistoryCsv} disabled={filteredHistory.length === 0} title="Export CSV" aria-label="Export CSV"
                className="p-1 text-rmpg-400 hover:text-[#d4a017] disabled:opacity-30">
                <Download style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={exportHistoryJson} disabled={filteredHistory.length === 0} title="Export JSON" aria-label="Export JSON"
                className="p-1 text-rmpg-400 hover:text-[#d4a017] disabled:opacity-30">
                <FileJson style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={printHistory} title="Print" aria-label="Print"
                className="p-1 text-rmpg-400 hover:text-[#d4a017]">
                <Printer style={{ width: 11, height: 11 }} />
              </button>
              <button type="button" onClick={() => setAutoScrollLock(v => !v)} title="Auto-scroll lock (L)" aria-label="Auto-scroll lock"
                className="p-1" style={{ color: autoScrollLock ? '#d4a017' : '#666' }}>
                {autoScrollLock ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
              </button>

              {showSearchHistory && (savedSearches.length > 0 || searchHistory.length > 0) && (
                <div className="absolute top-full left-0 right-0 z-30 max-h-48 overflow-y-auto" style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderTop: 'none' }}>
                  {savedSearches.length > 0 && <div className="px-2 py-1 text-[8px] font-mono text-rmpg-600 tracking-wider">SAVED</div>}
                  {savedSearches.map(s => (
                    <div key={'sv'+s} className="flex items-center gap-1 px-2 py-1 hover:bg-[#161616]">
                      <Bookmark style={{ width: 9, height: 9, color: '#d4a017' }} />
                      <button type="button" onMouseDown={() => setHistorySearch(s)} className="flex-1 text-left text-[10px] font-mono text-rmpg-300 truncate">{s}</button>
                      <button type="button" onMouseDown={() => removeSavedSearch(s)} aria-label="Remove saved search" className="text-rmpg-600 hover:text-red-400">
                        <X style={{ width: 9, height: 9 }} />
                      </button>
                    </div>
                  ))}
                  {searchHistory.length > 0 && <div className="px-2 py-1 text-[8px] font-mono text-rmpg-600 tracking-wider mt-1">RECENT</div>}
                  {searchHistory.map(s => (
                    <button key={'rc'+s} type="button" onMouseDown={() => setHistorySearch(s)} className="w-full flex items-center gap-1 px-2 py-1 text-left hover:bg-[#161616]">
                      <Clock style={{ width: 9, height: 9, color: '#666' }} />
                      <span className="flex-1 text-[10px] font-mono text-rmpg-400 truncate">{s}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Active filter pill */}
            {(filterUserId || historyChannel) && (
              <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono" style={{ background: '#1a1a1a', borderBottom: '1px solid #1f1f1f' }}>
                <Filter style={{ width: 9, height: 9, color: '#d4a017' }} />
                <span className="text-rmpg-400">FILTER:</span>
                {filterUserId && (
                  <button type="button" onClick={() => setFilterUserId(null)} className="flex items-center gap-1 px-1.5 py-0.5 text-[#d4a017]" style={{ border: '1px solid #d4a01744' }}>
                    USER · #{filterUserId} <X style={{ width: 8, height: 8 }} />
                  </button>
                )}
                {historyChannel && (
                  <button type="button" onClick={() => setHistoryChannel('')} className="flex items-center gap-1 px-1.5 py-0.5 text-[#d4a017]" style={{ border: '1px solid #d4a01744' }}>
                    CH · {historyChannel} <X style={{ width: 8, height: 8 }} />
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">

              {/* ON CHANNEL */}
              <SectionHeader icon={<Users style={{ width: 11, height: 11, color: '#d4a017' }} />} label={`ON CHANNEL · ${channelUsers.length}`} />
              <div className="px-2 py-1">
                {!currentChannel ? (
                  <div className="px-1 py-1 text-[10px] font-mono italic text-rmpg-600">No channel joined</div>
                ) : channelUsers.length === 0 ? (
                  <div className="px-1 py-1 text-[10px] font-mono italic text-rmpg-600">Waiting for units…</div>
                ) : (
                  channelUsers.map((u) => {
                    const isMe = u.userId === Number(user?.id);
                    const isSpeaking = activeSpeaker?.userId === u.userId;
                    return (
                      <div key={u.userId} className="group flex items-center gap-2 px-1 py-1 hover:bg-[#161616]">
                        <span className="led-dot" style={{ background: isSpeaking ? '#ef4444' : '#22c55e', boxShadow: `0 0 4px ${isSpeaking ? '#ef4444' : '#22c55e'}` }} />
                        <button
                          type="button"
                          onClick={() => setFilterUserId(u.userId === filterUserId ? null : u.userId)}
                          className="flex-1 min-w-0 text-left"
                          title="Click to filter their transmissions"
                        >
                          <div className="text-[11px] font-mono text-white truncate">
                            {u.fullName || u.username || 'Unknown'}
                            {isMe && <span className="text-[8px] font-mono text-[#d4a017] ml-1">YOU</span>}
                          </div>
                          {u.role && <div className="text-[8px] font-mono uppercase tracking-wider text-rmpg-600">{u.role}</div>}
                        </button>
                        {!isMe && !isInCall && (
                          <button type="button" onClick={() => startCall(u.userId)} aria-label={`Call ${u.fullName || u.username}`}
                            title={`Call ${u.fullName || u.username}`}
                            className="opacity-0 group-hover:opacity-100 p-1 text-rmpg-400 hover:text-[#d4a017]">
                            <Phone style={{ width: 11, height: 11 }} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* TODAY STATS */}
              <SectionHeader icon={<BarChart3 style={{ width: 11, height: 11, color: '#d4a017' }} />} label="TODAY · STATS" />
              <div className="px-2 py-1.5 grid grid-cols-2 gap-1.5">
                <Stat label="MY TX" value={String(stats.myTxCount)} />
                <Stat label="MY AIR" value={formatDuration(stats.myAirSec) || '0s'} />
                <Stat label="ALL TX" value={String(stats.allTxCount)} />
                <Stat label="ALL AIR" value={formatDuration(stats.allAirSec) || '0s'} />
              </div>

              {/* TOP TRANSMITTERS */}
              <SectionHeader icon={<TrendingUp style={{ width: 11, height: 11, color: '#d4a017' }} />} label="TOP UNITS · TODAY" />
              <div className="px-2 py-1">
                {stats.top.length === 0 ? (
                  <div className="px-1 text-[10px] font-mono italic text-rmpg-600">No traffic today</div>
                ) : (
                  stats.top.map((t, i) => (
                    <div key={t.name + i} className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] font-mono">
                      <span className="text-[#d4a017] font-bold w-[14px]">{i + 1}.</span>
                      <span className="text-rmpg-300 flex-1 truncate">{t.name}</span>
                      <span className="text-rmpg-500 tabular-nums">{t.count}</span>
                      <span className="text-rmpg-600 tabular-nums">{formatDuration(t.sec) || '0s'}</span>
                    </div>
                  ))
                )}
              </div>

              {/* LIVE LOG */}
              <SectionHeader
                icon={<span className="led-dot" style={{ background: '#ef4444', boxShadow: '0 0 4px #ef4444' }} />}
                label={`LIVE · ${transmissionLog.length}`}
              />
              <div className="px-2 py-1">
                {transmissionLog.length === 0 ? (
                  <div className="px-1 text-[10px] font-mono italic text-rmpg-600">No live traffic</div>
                ) : (
                  transmissionLog.slice().reverse().slice(0, 10).map(entry => {
                    const isMe = Number(entry.userId) === Number(user?.id);
                    return (
                      <div key={entry.id} className="flex items-start gap-2 py-0.5 border-b" style={{ borderColor: '#171717', background: isMe ? 'rgba(212,160,23,0.06)' : 'transparent' }}>
                        <span className="text-[9px] font-mono text-rmpg-600 tabular-nums flex-shrink-0 mt-px">
                          {formatLogTime(entry.startedAt)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-rmpg-200 truncate">
                              {entry.fullName || entry.username || 'Unknown'}{isMe && <span className="text-[#d4a017] ml-1">·YOU</span>}
                            </span>
                            <button type="button" onClick={() => setHistoryChannel(historyChannel === entry.channel ? '' : entry.channel)}
                              className="text-[8px] font-mono font-bold tracking-wider px-1" style={{ background: '#1a1a1a', color: '#d4a017' }}>
                              {(entry.channel || '').toUpperCase()}
                            </button>
                          </div>
                          {entry.transcript && <div className="text-[10px] font-mono text-rmpg-400 italic mt-0.5 leading-snug">"{entry.transcript}"</div>}
                        </div>
                        {entry.hasAudio && <Volume2 size={10} className="text-green-600 flex-shrink-0 mt-px" />}
                      </div>
                    );
                  })
                )}
              </div>

              {/* HISTORY */}
              <SectionHeader
                icon={<Activity style={{ width: 11, height: 11, color: '#d4a017' }} />}
                label={`HISTORY · ${filteredHistory.length}${markedIds.size ? ` · ${markedIds.size} marked` : ''}`}
              />
              <div className="px-2 py-1">
                {historyLoading ? (
                  <div className="px-1 py-2 text-[10px] font-mono italic text-rmpg-600">Loading…</div>
                ) : filteredHistory.length === 0 ? (
                  <div className="px-1 py-2 text-[10px] font-mono italic text-rmpg-600">No archived transmissions</div>
                ) : (
                  filteredHistory.map(entry => {
                    const isMe = Number(entry.user_id) === Number(user?.id);
                    const isMarked = markedIds.has(String(entry.id));
                    return (
                      <div key={entry.id} className="py-1 border-b" style={{ borderColor: '#171717', background: isMe ? 'rgba(212,160,23,0.05)' : isMarked ? 'rgba(212,160,23,0.08)' : 'transparent' }}>
                        <div className="flex items-start gap-1.5">
                          <span className="text-[9px] font-mono text-rmpg-600 tabular-nums flex-shrink-0 mt-px w-[58px]">
                            {formatLogTime(entry.transmitted_at)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 flex-wrap">
                              <button type="button" onClick={() => setFilterUserId(Number(entry.user_id) === filterUserId ? null : Number(entry.user_id))}
                                className="text-[10px] font-mono text-rmpg-200 truncate hover:text-[#d4a017]"
                                title="Filter by this user">
                                {entry.full_name || entry.username || 'Unknown'}{isMe && <span className="text-[#d4a017] ml-1">·YOU</span>}
                              </button>
                              <button type="button" onClick={() => setHistoryChannel(historyChannel === entry.channel ? '' : entry.channel)}
                                className="text-[8px] font-mono font-bold tracking-wider px-1 hover:bg-[#222]" style={{ background: '#1a1a1a', color: '#d4a017' }}>
                                {(entry.channel || '').toUpperCase()}
                              </button>
                              {entry.duration > 0 && <span className="text-[8px] font-mono text-rmpg-600">{formatDuration(entry.duration)}</span>}
                            </div>
                            {entry.transcript && (
                              <div className="text-[10px] font-mono text-rmpg-400 italic mt-0.5 leading-snug">
                                "{highlight(entry.transcript, historySearch)}"
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 flex-shrink-0 mt-px">
                            <button type="button" onClick={() => toggleMark(String(entry.id))}
                              className="p-0.5" aria-label={isMarked ? 'Unmark' : 'Mark important'} title={isMarked ? 'Unmark' : 'Mark important'}>
                              {isMarked
                                ? <BookmarkCheck size={11} className="text-[#d4a017]" />
                                : <Bookmark size={11} className="text-rmpg-600 hover:text-[#d4a017]" />}
                            </button>
                            {entry.audio_file && (
                              <>
                                <button type="button" onClick={() => togglePlayback(entry)} className="p-0.5"
                                  title={playingId === entry.id ? 'Stop playback' : 'Play recording'}
                                  aria-label={playingId === entry.id ? 'Stop playback' : 'Play recording'}>
                                  {playingId === entry.id ? <Square size={11} className="text-red-400" /> : <Play size={11} className="text-green-400" />}
                                </button>
                                <button type="button" onClick={() => downloadRecording(entry)} className="p-0.5"
                                  title="Download" aria-label={`Download recording from ${entry.full_name || entry.username || 'unit'}`}>
                                  <Download size={11} className="text-rmpg-500 hover:text-[#d4a017]" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {playingId === entry.id && playbackDuration > 0 && (
                          <div className="mt-1.5 pl-[60px] pr-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-mono text-rmpg-500 tabular-nums w-[34px] text-right">
                                {formatDuration(Math.floor(playbackTime))}
                              </span>
                              <input type="range" min={0} max={playbackDuration} step={0.1} value={playbackTime}
                                onChange={(e) => seekPlayback(Number(e.target.value))}
                                aria-label="Seek within recording"
                                className="flex-1 h-[3px] accent-[#d4a017] bg-[#222] cursor-pointer" />
                              <span className="text-[9px] font-mono text-rmpg-500 tabular-nums w-[34px]">
                                {formatDuration(Math.floor(playbackDuration))}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 justify-center">
                              <button type="button" onClick={() => seekPlayback(Math.max(0, playbackTime - 5))} className="p-0.5 text-rmpg-400 hover:text-[#d4a017]" title="Back 5s" aria-label="Back 5 seconds">
                                <Rewind style={{ width: 10, height: 10 }} />
                              </button>
                              {PLAYBACK_SPEEDS.map(s => (
                                <button key={s} type="button" onClick={() => changeSpeed(s)}
                                  className="text-[8px] font-mono font-bold px-1"
                                  style={{ color: playbackSpeed === s ? '#d4a017' : '#666', textDecoration: playbackSpeed === s ? 'underline' : 'none' }}>
                                  {s}×
                                </button>
                              ))}
                              <button type="button" onClick={() => seekPlayback(Math.min(playbackDuration, playbackTime + 5))} className="p-0.5 text-rmpg-400 hover:text-[#d4a017]" title="Forward 5s" aria-label="Forward 5 seconds">
                                <FastForward style={{ width: 10, height: 10 }} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ─── CSS ─────────────────────────────────────────── */}
      <style>{`
        .radio-ptt-btn { border-radius: 50% !important; }
        @keyframes radioWave {
          0% { height: 4px; }
          100% { height: 22px; }
        }
        @keyframes radioPulse {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.35); opacity: 0; }
        }
        @keyframes incomingCallPulse {
          0%, 100% { background: rgba(34, 197, 94, 0.18); }
          50% { background: rgba(34, 197, 94, 0.32); }
        }
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

function playBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    o.start(); o.stop(ctx.currentTime + 0.15);
    setTimeout(() => ctx.close().catch(() => {}), 300);
  } catch { /* ignore */ }
}

function Sep() {
  return <span className="text-[10px] font-mono" style={{ color: '#444' }}>│</span>;
}

function Banner({ icon, color, bg, children }: { icon: React.ReactNode; color: string; bg: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2" style={{ background: bg, borderBottom: `1px solid ${color}66` }}>
      {icon}
      <div className="flex-1 text-[10px] font-mono flex items-center gap-2">{children}</div>
    </div>
  );
}

function ToolbarBtn({ children, onClick, active, danger, title }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean; title?: string }) {
  const fg = danger ? '#ef4444' : active ? '#d4a017' : '#888';
  const bg = active ? `${fg}15` : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono font-bold tracking-wider transition-colors"
      style={{ border: `1px solid ${active ? fg : '#2e2e2e'}`, color: fg, background: bg }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ icon, label, trailing }: { icon: React.ReactNode; label: string; trailing?: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0"
      style={{ background: 'linear-gradient(180deg, #1a1a1a 0%, #141414 100%)', borderBottom: '1px solid #1f1f1f' }}
    >
      {icon}
      <span className="text-[9px] font-mono font-bold tracking-[0.2em] text-rmpg-300 flex-1 truncate">{label}</span>
      {trailing}
    </div>
  );
}

function Waveform({ color, reverse = false }: { color: string; reverse?: boolean }) {
  const bars = reverse ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  return (
    <div className="flex items-end gap-0.5 h-6">
      {bars.map(i => (
        <div key={i} className="w-1" style={{ background: color, animation: `radioWave 0.6s ease-in-out ${i * 0.1}s infinite alternate` }} />
      ))}
    </div>
  );
}

function EmptyConsole({ isConnected, channels }: { isConnected: boolean; channels: number }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4 text-center">
      <div
        className="w-24 h-24 flex items-center justify-center"
        style={{
          background: 'radial-gradient(circle at 30% 30%, #1a1a1a 0%, #0a0a0a 70%)',
          border: '3px solid #1f1f1f',
          boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.6)',
          borderRadius: '50%',
        }}
      >
        <Antenna style={{ width: 36, height: 36, color: '#333' }} />
      </div>
      <div>
        <div className="text-sm font-mono font-bold tracking-[0.3em] text-rmpg-300">NO CHANNEL JOINED</div>
        <div className="text-[10px] font-mono text-rmpg-600 mt-1 tracking-wider">
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
    <div className="px-2 py-1.5" style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      <div className="text-[8px] font-mono tracking-[0.2em] text-rmpg-600">{label}</div>
      <div className="text-base font-mono font-bold text-white tabular-nums leading-tight">{value}</div>
    </div>
  );
}

function Sparkline({ values, highlight }: { values: number[]; highlight?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-px h-8 px-2 py-1" style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}>
      {values.map((v, i) => {
        const h = Math.max(2, (v / max) * 100);
        const isNow = i === highlight;
        return (
          <div key={i}
            className="flex-1"
            title={`${i.toString().padStart(2,'0')}:00 — ${v} tx`}
            style={{
              height: `${h}%`,
              background: isNow ? '#d4a017' : v === 0 ? '#1a1a1a' : '#2a8a2a',
              boxShadow: isNow ? '0 0 4px #d4a017' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 mx-0.5 text-[9px] font-mono font-bold text-white" style={{ background: '#1a1a1a', border: '1px solid #333' }}>
      {children}
    </kbd>
  );
}
