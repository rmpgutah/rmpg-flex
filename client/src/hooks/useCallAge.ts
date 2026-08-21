import { useState, useEffect } from 'react';
import { parseTimestamp } from '../utils/dateUtils';

export interface CallAgeResult {
  elapsed: string;   // "HH:MM:SS"
  elapsedMs: number;
  colorClass: string;
  priority: string | undefined;
}

/**
 * useCallAge — live call-age timer counting up from createdAt.
 * Color: green <15min, amber 15-30min, red >30min for P1/P2.
 * All other priorities: amber threshold at 30min, red at 60min.
 */
export function useCallAge(createdAt: string | null | undefined, priority?: string): CallAgeResult {
  const [elapsedMs, setElapsedMs] = useState<number>(() => {
    if (!createdAt) return 0;
    return Math.max(0, Date.now() - parseTimestamp(createdAt).getTime());
  });

  useEffect(() => {
    if (!createdAt) return;
    const tick = () => {
      setElapsedMs(Math.max(0, Date.now() - parseTimestamp(createdAt).getTime()));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  const totalSec = Math.floor(elapsedMs / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const elapsed =
    hrs > 0
      ? `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const elapsedMin = elapsedMs / 60000;
  const isHighPriority = priority === 'P1' || priority === 'P2';
  let colorClass: string;
  if (isHighPriority) {
    if (elapsedMin < 15) colorClass = 'text-green-400';
    else if (elapsedMin < 30) colorClass = 'text-amber-400';
    else colorClass = 'text-red-400';
  } else {
    if (elapsedMin < 30) colorClass = 'text-green-400';
    else if (elapsedMin < 60) colorClass = 'text-amber-400';
    else colorClass = 'text-red-400';
  }

  return { elapsed, elapsedMs, colorClass, priority };
}
