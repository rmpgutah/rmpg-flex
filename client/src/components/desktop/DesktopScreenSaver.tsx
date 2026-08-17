import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Radio, Users, AlertTriangle } from 'lucide-react';
import { useClock } from '../../hooks/useClock';
import { apiFetch } from '../../hooks/useApi';

// Screensaver idle threshold in seconds (shorter than lock — dismiss with any input)
const DEFAULT_SS_SECS = 120; // 2 min

function getScreenSaverSecs(): number {
  try {
    const v = localStorage.getItem('rmpg_desktop_screensaver_secs');
    if (v !== null) {
      const parsed = parseInt(v, 10);
      // 0 = "Never" — must check separately; Math.max(30, 0) = 30 would silently
      // override the user's choice and fire the screensaver every 30 seconds.
      if (parsed === 0) return Number.MAX_SAFE_INTEGER;
      return Math.max(30, parsed);
    }
  } catch { /* ignore */ }
  return DEFAULT_SS_SECS;
}

interface AmbientStats {
  active_calls: number;
  available_units: number;
  total_units: number;
  critical_calls: number;
}

// Animated floating position — the display drifts around slowly so it never
// burns in the same pixels (classic CRT screensaver behaviour).
function useDriftPosition() {
  const [pos, setPos] = useState({ x: 50, y: 50 }); // percent
  useEffect(() => {
    const id = setInterval(() => {
      setPos(p => ({
        x: Math.max(10, Math.min(90, p.x + (Math.random() - 0.5) * 3)),
        y: Math.max(10, Math.min(90, p.y + (Math.random() - 0.5) * 3)),
      }));
    }, 4000);
    return () => clearInterval(id);
  }, []);
  return pos;
}

export interface DesktopScreenSaverProps {
  /** Controlled from parent: whether the screensaver is currently shown */
  isActive: boolean;
  /** Called when user input dismisses the screensaver */
  onDismiss: () => void;
}

export default function DesktopScreenSaver({ isActive, onDismiss }: DesktopScreenSaverProps) {
  const { time, date } = useClock();
  const pos = useDriftPosition();
  const [stats, setStats] = useState<AmbientStats | null>(null);

  // Load ambient CAD stats every 60s
  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        const s = await apiFetch<AmbientStats>('/dispatch/ambient-stats');
        if (!cancelled && s) setStats(s);
      } catch { /* silent — screensaver should never crash */ }
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
        zIndex: 9990, // just below lock screen (9999)
        background: '#000',
        cursor: 'none',
        userSelect: 'none',
      }}
    >
      {/* Drifting content block */}
      <div
        style={{
          position: 'absolute',
          left: `${pos.x}%`,
          top: `${pos.y}%`,
          transform: 'translate(-50%, -50%)',
          transition: 'left 4s ease, top 4s ease',
          textAlign: 'center',
          color: '#fff',
          minWidth: 280,
        }}
      >
        {/* Agency shield */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <Shield style={{ width: 20, height: 20, color: 'rgba(var(--accent-silver-400-rgb),0.4)' }} />
          <span style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(var(--accent-silver-400-rgb),0.4)', fontWeight: 600 }}>
            Rocky Mountain Protective Group
          </span>
        </div>

        {/* Clock */}
        <div style={{ fontSize: 64, fontWeight: 200, letterSpacing: '-0.02em', lineHeight: 1, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </div>
        <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {date}
        </div>

        {/* Ambient stats (only if API returned them) */}
        {stats && (
          <div style={{ marginTop: 24, display: 'flex', gap: 20, justifyContent: 'center' }}>
            <StatPill
              icon={<Radio style={{ width: 12, height: 12 }} />}
              label="Active"
              value={stats.active_calls}
              critical={stats.critical_calls > 0}
            />
            <StatPill
              icon={<Users style={{ width: 12, height: 12 }} />}
              label="Units"
              value={`${stats.available_units}/${stats.total_units}`}
            />
            {stats.critical_calls > 0 && (
              <StatPill
                icon={<AlertTriangle style={{ width: 12, height: 12 }} />}
                label="P1"
                value={stats.critical_calls}
                critical
              />
            )}
          </div>
        )}
      </div>
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
