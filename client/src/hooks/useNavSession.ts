// ============================================================
// useNavSession — persisted Drive Mode trip-odometer state
//
// Persists the running nav session (start time, accumulated distance,
// observed top speed) to localStorage 'rmpg-nav-session' so a mid-shift
// reload — or the SW serving a fresh bundle — does NOT zero the odometer.
//
// Self-contained: SSR-safe, debounced writes, defensive parse.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

const LS_KEY = 'rmpg-nav-session';
const WRITE_DEBOUNCE_MS = 200;

export interface NavSessionState {
  /** Epoch ms when the session began. */
  sessionStart: number;
  /** Accumulated odometer distance for this session, in meters. */
  distanceMeters: number;
  /** Peak observed speed this session, in mph. */
  maxMph: number;
}

export interface UseNavSessionResult extends NavSessionState {
  /** Add a movement delta (meters) and report the current speed (mph). */
  bump: (deltaMeters: number, mph?: number) => void;
  /** Start a brand-new session (zeroes the odometer, resets the clock). */
  reset: () => void;
}

const num = (x: unknown, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;

function freshState(): NavSessionState {
  return { sessionStart: Date.now(), distanceMeters: 0, maxMph: 0 };
}

function loadState(): NavSessionState {
  if (typeof window === 'undefined') return freshState();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw == null) return freshState();
    const parsed = JSON.parse(raw) as Partial<NavSessionState>;
    if (typeof parsed !== 'object' || parsed === null) return freshState();
    return {
      sessionStart: num(parsed.sessionStart, Date.now()),
      distanceMeters: Math.max(0, num(parsed.distanceMeters, 0)),
      maxMph: Math.max(0, num(parsed.maxMph, 0)),
    };
  } catch {
    return freshState();
  }
}

export function useNavSession(): UseNavSessionResult {
  const [state, setState] = useState<NavSessionState>(() => loadState());
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<NavSessionState>(state);

  const scheduleWrite = useCallback((next: NavSessionState) => {
    pendingRef.current = next;
    if (typeof window === 'undefined') return;
    if (writeTimer.current) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      writeTimer.current = null;
      try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(pendingRef.current));
      } catch {
        /* ignore */
      }
    }, WRITE_DEBOUNCE_MS);
  }, []);

  const bump = useCallback(
    (deltaMeters: number, mph?: number) => {
      setState((prev) => {
        const add = Number.isFinite(deltaMeters) && deltaMeters > 0 ? deltaMeters : 0;
        const speed = typeof mph === 'number' && Number.isFinite(mph) ? mph : 0;
        const next: NavSessionState = {
          sessionStart: prev.sessionStart,
          distanceMeters: prev.distanceMeters + add,
          maxMph: Math.max(prev.maxMph, speed),
        };
        scheduleWrite(next);
        return next;
      });
    },
    [scheduleWrite],
  );

  const reset = useCallback(() => {
    const next = freshState();
    setState(next);
    scheduleWrite(next);
  }, [scheduleWrite]);

  // Flush pending write on unmount.
  useEffect(() => {
    return () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(LS_KEY, JSON.stringify(pendingRef.current));
          } catch {
            /* ignore */
          }
        }
      }
    };
  }, []);

  return {
    sessionStart: state.sessionStart,
    distanceMeters: state.distanceMeters,
    maxMph: state.maxMph,
    bump,
    reset,
  };
}

export default useNavSession;
