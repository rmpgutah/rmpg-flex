import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

type PanicPhase = 'idle' | 'holding' | 'active' | 'error';

const HOLD_DURATION_MS = 3000;
const LS_KEY = 'rmpg_last_panic';

export default function DesktopPanicWidget() {
  const [phase, setPhase] = useState<PanicPhase>('idle');
  const [progress, setProgress] = useState(0); // 0–1 during hold
  const [lastActivation, setLastActivation] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const holdStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) setLastActivation(stored);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  function startHold() {
    if (phase === 'active') return;
    holdStartRef.current = Date.now();
    setPhase('holding');
    setProgress(0);
    tick();
  }

  function tick() {
    rafRef.current = requestAnimationFrame(() => {
      if (holdStartRef.current === null) return;
      const elapsed = Date.now() - holdStartRef.current;
      const p = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setProgress(p);
      if (p < 1) {
        tick();
      } else {
        triggerPanic();
      }
    });
  }

  function cancelHold() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    holdStartRef.current = null;
    setPhase('idle');
    setProgress(0);
  }

  async function triggerPanic() {
    holdStartRef.current = null;
    setProgress(1);
    const ts = new Date().toISOString();
    try {
      await apiFetch('/dispatch/calls', {
        method: 'POST',
        body: JSON.stringify({
          incident_type: 'officer_down',
          priority: 1,
          status: 'active',
          location_address: 'GPS LOCATION',
          notes: 'Activated via FlexOS panic widget',
          officer_safety_caution: true,
        }),
        headers: { 'Content-Type': 'application/json' },
      } as RequestInit);
      localStorage.setItem(LS_KEY, ts);
      setLastActivation(ts);
      setPhase('active');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  function dismiss() {
    setPhase('idle');
    setProgress(0);
    setErrorMsg('');
  }

  // Circumference for SVG ring (r=28, c=2πr≈175.9)
  const RADIUS = 28;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - progress);

  // Flashing class for active state
  const [flashOn, setFlashOn] = useState(true);
  useEffect(() => {
    if (phase !== 'active') return;
    const id = setInterval(() => setFlashOn(v => !v), 600);
    return () => clearInterval(id);
  }, [phase]);

  const remainingSeconds = phase === 'holding'
    ? Math.ceil((HOLD_DURATION_MS - progress * HOLD_DURATION_MS) / 1000)
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', width: '100%' }}>

      {/* Widget label */}
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'rgb(var(--text-secondary-rgb, var(--rmpg-300-rgb)))',
        alignSelf: 'flex-start',
      }}>
        Emergency
      </div>

      {/* ACTIVE state */}
      {phase === 'active' && (
        <div style={{
          width: '100%',
          border: `2px solid rgb(var(--sev-critical-rgb))`,
          borderRadius: 2,
          padding: '6px 4px',
          background: flashOn
            ? 'rgba(var(--sev-critical-rgb), 0.18)'
            : 'rgba(var(--sev-critical-rgb), 0.06)',
          textAlign: 'center',
          transition: 'background 0.3s',
        }}>
          <div style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.08em',
            color: 'rgb(var(--sev-critical-rgb))',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            Emergency Active
          </div>
          <div style={{
            fontSize: 9,
            color: 'rgb(var(--sev-critical-rgb))',
            marginBottom: 6,
            opacity: 0.85,
          }}>
            Help Dispatched
          </div>
          <button
            onClick={dismiss}
            style={{
              fontSize: 9,
              padding: '2px 8px',
              borderRadius: 2,
              border: '1px solid rgb(var(--sev-critical-rgb))',
              background: 'transparent',
              color: 'rgb(var(--sev-critical-rgb))',
              cursor: 'pointer',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ERROR state */}
      {phase === 'error' && (
        <div style={{
          width: '100%',
          border: '1px solid rgb(var(--sev-warn-rgb, var(--rmpg-400-rgb)))',
          borderRadius: 2,
          padding: '5px 4px',
          textAlign: 'center',
          background: 'rgba(var(--sev-warn-rgb, var(--rmpg-400-rgb)), 0.1)',
        }}>
          <div style={{ fontSize: 9, color: 'rgb(var(--sev-warn-rgb, var(--rmpg-400-rgb)))', marginBottom: 4, fontWeight: 700 }}>
            Dispatch Failed
          </div>
          <div style={{ fontSize: 8, color: 'rgb(var(--text-secondary-rgb))', marginBottom: 5, wordBreak: 'break-word' }}>
            {errorMsg || 'Network error'}
          </div>
          <button
            onClick={dismiss}
            style={{
              fontSize: 9,
              padding: '2px 8px',
              borderRadius: 2,
              border: '1px solid rgb(var(--text-secondary-rgb))',
              background: 'transparent',
              color: 'rgb(var(--text-secondary-rgb))',
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* IDLE / HOLDING state — main panic button */}
      {(phase === 'idle' || phase === 'holding') && (
        <div style={{ position: 'relative', width: 76, height: 76, flexShrink: 0 }}>
          {/* SVG progress ring */}
          <svg
            width={76}
            height={76}
            style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}
          >
            {/* Track */}
            <circle
              cx={38}
              cy={38}
              r={RADIUS}
              fill="none"
              stroke="rgba(var(--rmpg-700-rgb), 0.4)"
              strokeWidth={4}
            />
            {/* Progress arc */}
            {phase === 'holding' && (
              <circle
                cx={38}
                cy={38}
                r={RADIUS}
                fill="none"
                stroke="rgb(var(--sev-critical-rgb))"
                strokeWidth={4}
                strokeDasharray={CIRC}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-dashoffset 0.05s linear' }}
              />
            )}
          </svg>

          {/* Button */}
          <button
            onMouseDown={startHold}
            onMouseUp={cancelHold}
            onMouseLeave={cancelHold}
            onTouchStart={startHold}
            onTouchEnd={cancelHold}
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              width: 60,
              height: 60,
              borderRadius: '50%',
              border: phase === 'holding'
                ? '2px solid rgb(var(--sev-critical-rgb))'
                : '2px solid rgba(var(--sev-critical-rgb), 0.7)',
              background: phase === 'holding'
                ? `rgba(var(--sev-critical-rgb), ${0.15 + progress * 0.35})`
                : 'rgba(var(--sev-critical-rgb), 0.12)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              userSelect: 'none',
              WebkitUserSelect: 'none',
              transition: 'background 0.1s',
              outline: 'none',
            }}
          >
            <span style={{
              fontSize: phase === 'holding' ? 8 : 7,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'rgb(var(--sev-critical-rgb))',
              lineHeight: 1.1,
              textAlign: 'center',
              pointerEvents: 'none',
            }}>
              {phase === 'holding' ? `${remainingSeconds}s` : 'OFFICER'}
            </span>
            <span style={{
              fontSize: phase === 'holding' ? 7 : 7,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'rgb(var(--sev-critical-rgb))',
              lineHeight: 1.1,
              textAlign: 'center',
              pointerEvents: 'none',
            }}>
              {phase === 'holding' ? 'HOLD' : 'DOWN'}
            </span>
          </button>
        </div>
      )}

      {/* Instruction text */}
      {phase === 'idle' && (
        <div style={{
          fontSize: 8,
          color: 'rgb(var(--text-secondary-rgb))',
          textAlign: 'center',
          lineHeight: 1.3,
          opacity: 0.75,
        }}>
          Hold 3 sec to activate
        </div>
      )}

      {/* Cancel during hold */}
      {phase === 'holding' && (
        <button
          onMouseDown={cancelHold}
          style={{
            fontSize: 8,
            padding: '2px 10px',
            borderRadius: 2,
            border: '1px solid rgb(var(--text-secondary-rgb))',
            background: 'transparent',
            color: 'rgb(var(--text-secondary-rgb))',
            cursor: 'pointer',
            letterSpacing: '0.05em',
          }}
        >
          Cancel
        </button>
      )}

      {/* Last activation timestamp */}
      {lastActivation && phase !== 'active' && (
        <div style={{
          fontSize: 8,
          color: 'rgb(var(--text-secondary-rgb))',
          textAlign: 'center',
          opacity: 0.6,
          lineHeight: 1.3,
        }}>
          Last: {parseTimestamp(lastActivation).toLocaleString('en-US', {
            timeZone: 'America/Denver',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      )}
    </div>
  );
}
