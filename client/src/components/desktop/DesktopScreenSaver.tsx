import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useClock } from '../../hooks/useClock';
import { apiFetch } from '../../hooks/useApi';
import DesktopScreenSaverModes, { type ScreenSaverModeType } from './DesktopScreenSaverModes';

// Screensaver idle threshold in seconds
const DEFAULT_SS_SECS = 120; // 2 min

function getScreenSaverSecs(): number {
  try {
    const v = localStorage.getItem('rmpg_desktop_screensaver_secs');
    if (v !== null) {
      const parsed = parseInt(v, 10);
      if (parsed === 0) return Number.MAX_SAFE_INTEGER;
      return Math.max(30, parsed);
    }
  } catch { /* ignore */ }
  return DEFAULT_SS_SECS;
}

function getScreenSaverMode(): ScreenSaverModeType {
  try {
    const stored = localStorage.getItem('rmpg_desktop_ss_mode') as ScreenSaverModeType;
    if (stored) return stored;
  } catch { /* default */ }
  return 'clock-drift';
}

interface AmbientStats {
  active_calls: number;
  available_units: number;
  total_units: number;
  critical_calls: number;
}

// Animated floating position — drifts around slowly to prevent burn-in
function useDriftPosition(isStealth = false) {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  useEffect(() => {
    const intervalMs = isStealth ? 10_000 : 4000;
    const id = setInterval(() => {
      setPos(p => ({
        x: Math.max(15, Math.min(85, p.x + (Math.random() - 0.5) * 4)),
        y: Math.max(15, Math.min(85, p.y + (Math.random() - 0.5) * 4)),
      }));
    }, intervalMs);
    return () => clearInterval(id);
  }, [isStealth]);
  return pos;
}

export interface DesktopScreenSaverProps {
  isActive: boolean;
  onDismiss: () => void;
}

export default function DesktopScreenSaver({ isActive, onDismiss }: DesktopScreenSaverProps) {
  const { time, date } = useClock();
  const ssMode = getScreenSaverMode();
  const pos = useDriftPosition(ssMode === 'battery-stealth');
  const [stats, setStats] = useState<AmbientStats | null>(null);

  // Load ambient CAD stats every 60s
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        const s = await apiFetch<AmbientStats>('/dispatch/ambient-stats');
        if (!cancelled && s) setStats(s);
      } catch { /* silent fallback */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isActive]);

  // Dismiss on any keyboard, mouse, or touch input
  useEffect(() => {
    if (!isActive) return;
    const dismiss = () => onDismiss();
    window.addEventListener('keydown', dismiss, { once: true });
    window.addEventListener('mousedown', dismiss, { once: true });
    window.addEventListener('touchstart', dismiss, { once: true });
    return () => {
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('touchstart', dismiss);
    };
  }, [isActive, onDismiss]);

  if (!isActive) return null;

  return (
    <div
      aria-label="Screen saver — press any key to dismiss"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9990,
        background: ssMode === 'nvg-nightvision' ? '#0f0000' : '#000000',
        cursor: 'none',
        userSelect: 'none',
      }}
    >
      <DesktopScreenSaverModes
        mode={ssMode}
        time={time}
        date={date}
        stats={stats}
        pos={pos}
      />
    </div>
  );
}

function StatPill({ icon, label, value, critical }: { icon: React.ReactNode; label: string; value: number | string; critical?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: critical ? 'rgba(var(--sev-critical-rgb),0.7)' : 'rgba(var(--accent-silver-400-rgb),0.4)' }}>
        {icon}
        <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <span style={{ fontSize: 20, fontWeight: 200, color: critical ? 'rgba(var(--sev-critical-rgb),0.8)' : 'rgba(var(--accent-silver-400-rgb),0.5)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Hook to manage screensaver + lock screen idle state together.
 * Screensaver at SS_SECS, lock at LOCK_SECS.
 * Returns { ssActive, lockActive, dismissSS, dismissLock }
 */
export function useIdleScreenSaver(lockSecs: number) {
  const ssSecs = Math.min(getScreenSaverSecs(), lockSecs - 30);
  const [ssActive, setSsActive] = useState(false);
  const [lockActive, setLockActive] = useState(false);
  const lastInputRef = useRef(Date.now());

  // Track user input to reset idle timer
  useEffect(() => {
    const reset = () => { lastInputRef.current = Date.now(); };
    window.addEventListener('keydown', reset);
    window.addEventListener('mousemove', reset);
    window.addEventListener('mousedown', reset);
    window.addEventListener('touchstart', reset);
    return () => {
      window.removeEventListener('keydown', reset);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('mousedown', reset);
      window.removeEventListener('touchstart', reset);
    };
  }, []);

  useEffect(() => {
    // Use Tauri getIdleTime when available, otherwise fallback to JS input tracking
    const el = (window as any).electron;
    const useTauri = el?.isElectron && el?.getIdleTime;

    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      let idleSecs: number;
      if (useTauri) {
        try { idleSecs = await el.getIdleTime(); } catch { return; }
      } else {
        idleSecs = (Date.now() - lastInputRef.current) / 1000;
      }
      if (idleSecs >= lockSecs) {
        setSsActive(false);
        setLockActive(true);
      } else if (idleSecs >= ssSecs) {
        setSsActive(true);
      } else {
        setSsActive(false);
      }
    };

    const id = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [lockSecs, ssSecs]);

  const dismissSS = useCallback(() => {
    lastInputRef.current = Date.now();
    setSsActive(false);
  }, []);

  const dismissLock = useCallback(() => {
    lastInputRef.current = Date.now();
    setLockActive(false);
  }, []);

  return { ssActive, lockActive, dismissSS, dismissLock };
}
