/**
 * FlexOS Boot Splash
 *
 * Shown for a brief moment while the desktop shell initializes — auth check,
 * preference load, first render. Fades out automatically once `ready` is true.
 * Designed to feel like the boot sequence of a real embedded OS.
 */
import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';

export interface FlexOSBootSplashProps {
  /** When true the splash begins its fade-out. */
  ready: boolean;
  /** Called after the fade animation completes — parent should unmount. */
  onFaded: () => void;
}

const PHASES = [
  'Initializing secure environment…',
  'Loading Rocky Mountain Protective Group profile…',
  'Establishing API connection…',
  'Preparing FlexOS desktop shell…',
];

const PHASE_INTERVAL_MS = 600;

export default function FlexOSBootSplash({ ready, onFaded }: FlexOSBootSplashProps) {
  const [phase, setPhase] = useState(0);
  const [fading, setFading] = useState(false);

  // Cycle through status phases while waiting for ready
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => {
      setPhase(p => Math.min(p + 1, PHASES.length - 1));
    }, PHASE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready]);

  // Start fade-out when ready flips
  useEffect(() => {
    if (!ready) return;
    setPhase(PHASES.length - 1);
    const t = setTimeout(() => setFading(true), 200);
    return () => clearTimeout(t);
  }, [ready]);

  // Notify parent once fade finishes
  const handleTransitionEnd = () => {
    if (fading) onFaded();
  };

  return (
    <div
      role="status"
      aria-label="Loading FlexOS"
      onTransitionEnd={handleTransitionEnd}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000, // above everything including lock screen
        background: 'var(--surface-base, #22405f)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        opacity: fading ? 0 : 1,
        transition: fading ? 'opacity 600ms ease' : 'none',
        userSelect: 'none',
        pointerEvents: fading ? 'none' : 'all',
      }}
    >
      {/* Agency shield */}
      <div style={{
        width: 72,
        height: 72,
        borderRadius: 12,
        background: 'linear-gradient(145deg, rgba(var(--rmpg-700-rgb, 30 60 95), 0.9), rgba(var(--rmpg-500-rgb, 62 116 168), 0.5))',
        border: '1.5px solid rgba(195,204,214,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <Shield style={{ width: 40, height: 40, color: 'var(--accent-silver-300, #d4dde6)' }} />
      </div>

      {/* OS name */}
      <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary, #f0f4f9)', letterSpacing: '-0.02em', lineHeight: 1 }}>
        FlexOS
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted, #8da0b3)', marginTop: 6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        Rocky Mountain Protective Group
      </div>

      {/* Spinner bar */}
      <div style={{
        marginTop: 40,
        width: 200,
        height: 2,
        background: 'rgba(195,204,214,0.1)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: '100%',
          width: `${((phase + 1) / PHASES.length) * 100}%`,
          background: 'var(--accent-silver-400, #c3ccd6)',
          transition: 'width 500ms ease',
        }} />
      </div>

      {/* Status text */}
      <div style={{
        marginTop: 12,
        fontSize: 10,
        color: 'var(--text-muted, #8da0b3)',
        letterSpacing: '0.04em',
        minHeight: 16,
        transition: 'opacity 300ms',
      }}>
        {PHASES[phase]}
      </div>

      {/* Version footer */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        fontSize: 9,
        color: 'rgba(195,204,214,0.3)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        FlexOS v1.0.0 — Proprietary
      </div>
    </div>
  );
}
