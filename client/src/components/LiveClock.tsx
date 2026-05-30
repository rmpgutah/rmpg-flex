import React, { useState, useEffect } from 'react';

interface LiveClockProps {
  className?: string;
  style?: React.CSSProperties;
  /** IANA timezone — defaults to America/Denver (RMPG local wall-clock). */
  timeZone?: string;
  hour12?: boolean;
}

/**
 * Self-contained ticking wall-clock.
 *
 * Owns its own 1-second interval + state so the per-second update re-renders
 * ONLY this ~1-line component — never its parent. Extracted from DispatchPage,
 * where a page-level `statusBarTime` state ticked every second and forced a full
 * re-render of the 6,300-line component (continuous reconcile churn + battery
 * drain on field Toughbooks). Drop this in anywhere a live clock is needed
 * instead of holding the current time in page-level state.
 */
function LiveClock({ className, style, timeZone = 'America/Denver', hour12 = false }: LiveClockProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className={className} style={style}>
      {new Date(now).toLocaleTimeString('en-US', { hour12, timeZone })}
    </span>
  );
}

export default React.memo(LiveClock);
