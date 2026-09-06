import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from './AuthContext';

export interface ActiveCall {
  id: number; call_number: string; nature_of_call: string;
  priority: number; status: string; address?: string;
  created_at?: string;
}

export interface WelfareTimer { endsAt: number; intervalMinutes: number; }
export type FocusAssistLevel = 'off' | 'priority' | 'alarms-only';

export interface DesktopSystemState {
  nightLightOn: boolean; nightLightIntensity: number;
  dndOn: boolean; brightness: number; volume: number;
  focusAssist: FocusAssistLevel;
  activeCall: ActiveCall | null; welfareTimer: WelfareTimer | null;
  updateAvailable: string | null; clipboardHistory: string[];
  unitStatus: string; radioChannel: string; syncPending: number;
}

interface DesktopSystemActions {
  setNightLight: (on: boolean, intensity?: number) => void;
  setDnd: (on: boolean) => void;
  setBrightness: (value: number) => void;
  setVolume: (value: number) => void;
  setFocusAssist: (level: FocusAssistLevel) => void;
  startWelfareTimer: (minutes: number) => void;
  cancelWelfareTimer: () => void;
  dismissUpdate: () => void;
  addClipboardEntry: (text: string) => void;
  setUnitStatus: (status: string) => Promise<void>;
  setRadioChannel: (ch: string) => void;
}

const NIGHT_KEY = 'rmpg_night_light';
const DND_KEY = 'rmpg_dnd';
const FOCUS_ASSIST_KEY = 'rmpg_focus_assist';
const BRIGHTNESS_KEY = 'rmpg_brightness';
const RADIO_KEY = 'rmpg_radio_channel';
const WELFARE_KEY = 'rmpg_welfare_timer';
import {
  addClipEntry as persistClip, loadClipHistory, MAX_CLIP,
} from '../utils/clipboardStore';

const BRIGHTNESS_OVERLAY_ID = 'rmpg-brightness-overlay';

function applyBrightnessOverlay(pct: number) {
  let overlay = document.getElementById(BRIGHTNESS_OVERLAY_ID);
  if (pct >= 100) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = BRIGHTNESS_OVERLAY_ID;
    overlay.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:99998;background:#000;transition:opacity 150ms ease';
    document.body.appendChild(overlay);
  }
  overlay.style.opacity = String(1 - pct / 100);
}

const VOLUME_KEY = 'rmpg_desktop_volume';
const VOLUME_OVERLAY_ATTR = 'data-rmpg-vol';

function getPersistedVolume(): number {
  try { return Math.min(100, Math.max(0, parseInt(localStorage.getItem(VOLUME_KEY) ?? '100', 10))); }
  catch { return 100; }
}

function applyVolumeToAll(pct: number) {
  const v = pct / 100;
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach(el => {
    el.volume = v;
    el.setAttribute(VOLUME_OVERLAY_ATTR, '1');
  });
  try { localStorage.setItem(VOLUME_KEY, String(pct)); } catch {}
}

let volumeObserver: MutationObserver | null = null;

function ensureVolumeObserver(getVolume: () => number) {
  if (volumeObserver) return;
  volumeObserver = new MutationObserver((mutations) => {
    const v = getVolume() / 100;
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node instanceof HTMLElement) {
          const els = node.matches('audio, video')
            ? [node as HTMLMediaElement]
            : Array.from(node.querySelectorAll<HTMLMediaElement>('audio, video'));
          els.forEach(el => { el.volume = v; el.setAttribute(VOLUME_OVERLAY_ATTR, '1'); });
        }
      });
    }
  });
  volumeObserver.observe(document.body, { childList: true, subtree: true });
}

const DesktopSystemContext = createContext<(DesktopSystemState & DesktopSystemActions) | null>(null);

export function useDesktopSystem(): DesktopSystemState & DesktopSystemActions {
  const ctx = useContext(DesktopSystemContext);
  if (!ctx) throw new Error('useDesktopSystem must be used within DesktopSystemProvider');
  return ctx;
}

export function useOptionalDesktopSystem(): (DesktopSystemState & DesktopSystemActions) | null {
  return useContext(DesktopSystemContext);
}

function loadWelfare(): WelfareTimer | null {
  try {
    const raw = localStorage.getItem(WELFARE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as WelfareTimer;
    if (t.endsAt < Date.now()) { localStorage.removeItem(WELFARE_KEY); return null; }
    return t;
  } catch { return null; }
}

function loadClip(): string[] {
  try { return loadClipHistory(); }
  catch { return []; }
}

export function DesktopSystemProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [nightLightOn, setNightLightOnState] = useState(() => localStorage.getItem(NIGHT_KEY) === '1');
  const [nightLightIntensity, setNightLightIntensity] = useState(() => {
    const v = parseInt(localStorage.getItem(NIGHT_KEY + '_intensity') ?? '40', 10);
    return isNaN(v) ? 40 : v;
  });
  const [dndOn, setDndOnState] = useState(() => localStorage.getItem(DND_KEY) === '1');
  const [focusAssist, setFocusAssistState] = useState<FocusAssistLevel>(() => {
    const stored = localStorage.getItem(FOCUS_ASSIST_KEY);
    if (stored === 'priority' || stored === 'alarms-only') return stored;
    return 'off';
  });
  const [brightness, setBrightnessState] = useState(() => {
    const v = parseInt(localStorage.getItem(BRIGHTNESS_KEY) ?? '80', 10);
    return isNaN(v) ? 80 : v;
  });
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [welfareTimer, setWelfareTimer] = useState<WelfareTimer | null>(loadWelfare);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [clipboardHistory, setClipboardHistory] = useState<string[]>(loadClip);
  const [volume, setVolumeState] = useState(getPersistedVolume);
  const [unitStatus, setUnitStatusState] = useState('available');
  const [radioChannel, setRadioChannelState] = useState(() => localStorage.getItem(RADIO_KEY) ?? 'CH1');
  const [syncPending, setSyncPending] = useState(0);
  const dismissedVersion = useRef<string | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // Poll active call
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await apiFetch<{ call: ActiveCall | null }>('/system/my-call');
        if (!cancelled) setActiveCall(res?.call ?? null);
      } catch { /* offline-tolerant */ }
    }
    poll();
    const iv = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user?.id]);

  // Poll unit status
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await apiFetch<{ status: string }>('/system/my-unit-status');
        if (!cancelled && res?.status) setUnitStatusState(res.status);
      } catch { /* offline-tolerant */ }
    }
    poll();
    const iv = setInterval(poll, 20000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user?.id]);

  // Poll sync queue depth from Electron
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const el = (window as any).electron;
        if (el?.getOfflineWriteQueueSize) {
          const n = await el.getOfflineWriteQueueSize();
          if (!cancelled) setSyncPending(n ?? 0);
        }
      } catch { /* non-Electron */ }
    }
    poll();
    const iv = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Listen for Electron update-available event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ version: string }>).detail;
      if (detail?.version && detail.version !== dismissedVersion.current) {
        setUpdateAvailable(detail.version);
      }
    };
    window.addEventListener('flexos:update-available', handler);
    return () => window.removeEventListener('flexos:update-available', handler);
  }, []);

  // Welfare timer expiry
  useEffect(() => {
    if (!welfareTimer) return;
    const ms = welfareTimer.endsAt - Date.now();
    if (ms <= 0) { setWelfareTimer(null); return; }
    const t = setTimeout(() => setWelfareTimer(null), ms);
    return () => clearTimeout(t);
  }, [welfareTimer]);

  // Apply brightness on mount
  useEffect(() => {
    applyBrightnessOverlay(brightness);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply volume on mount + start MutationObserver for new media elements
  useEffect(() => {
    applyVolumeToAll(volume);
    ensureVolumeObserver(() => volumeRef.current);
    return () => { if (volumeObserver) { volumeObserver.disconnect(); volumeObserver = null; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setVolumeState(clamped);
    applyVolumeToAll(clamped);
    const el = (window as any).electron;
    if (el?.setVolume) el.setVolume(clamped).catch(() => {});
  }, []);

  const setNightLight = useCallback((on: boolean, intensity?: number) => {
    setNightLightOnState(on);
    localStorage.setItem(NIGHT_KEY, on ? '1' : '0');
    if (intensity !== undefined) {
      setNightLightIntensity(intensity);
      localStorage.setItem(NIGHT_KEY + '_intensity', String(intensity));
    }
  }, []);

  const setDnd = useCallback((on: boolean) => {
    setDndOnState(on);
    localStorage.setItem(DND_KEY, on ? '1' : '0');
  }, []);

  const setFocusAssist = useCallback((level: FocusAssistLevel) => {
    setFocusAssistState(level);
    localStorage.setItem(FOCUS_ASSIST_KEY, level);
  }, []);

  const setBrightness = useCallback((value: number) => {
    const clamped = Math.max(10, Math.min(100, value));
    setBrightnessState(clamped);
    localStorage.setItem(BRIGHTNESS_KEY, String(clamped));
    applyBrightnessOverlay(clamped);
    const el = (window as any).electron;
    if (el?.setBrightness) el.setBrightness(clamped).catch(() => {});
  }, []);

  const startWelfareTimer = useCallback((minutes: number) => {
    const t: WelfareTimer = { endsAt: Date.now() + minutes * 60_000, intervalMinutes: minutes };
    setWelfareTimer(t);
    localStorage.setItem(WELFARE_KEY, JSON.stringify(t));
  }, []);

  const cancelWelfareTimer = useCallback(() => {
    setWelfareTimer(null);
    localStorage.removeItem(WELFARE_KEY);
  }, []);

  const dismissUpdate = useCallback(() => {
    dismissedVersion.current = updateAvailable;
    setUpdateAvailable(null);
  }, [updateAvailable]);

  const addClipboardEntry = useCallback((text: string) => {
    setClipboardHistory((prev) => persistClip(prev, text).slice(0, MAX_CLIP));
  }, []);

  const setUnitStatus = useCallback(async (status: string) => {
    setUnitStatusState(status);
    try {
      await apiFetch('/system/my-unit-status', { method: 'PATCH', body: JSON.stringify({ status }) });
    } catch { /* offline */ }
  }, []);

  const setRadioChannel = useCallback((ch: string) => {
    setRadioChannelState(ch);
    localStorage.setItem(RADIO_KEY, ch);
  }, []);

  return (
    <DesktopSystemContext.Provider value={{
      nightLightOn, nightLightIntensity, dndOn, focusAssist, brightness, volume, activeCall, welfareTimer,
      updateAvailable, clipboardHistory, unitStatus, radioChannel, syncPending,
      setNightLight, setDnd, setFocusAssist, setBrightness, setVolume, startWelfareTimer, cancelWelfareTimer,
      dismissUpdate, addClipboardEntry, setUnitStatus, setRadioChannel,
    }}>
      {children}
    </DesktopSystemContext.Provider>
  );
}
