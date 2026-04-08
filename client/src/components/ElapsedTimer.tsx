// ============================================================
// RMPG Flex — Elapsed Timer (Spillman Flex Real-Time Counter)
// Live-updating HH:MM:SS timer for active calls
// ============================================================

import React, { useState, useEffect, useRef } from 'react';

interface ElapsedTimerProps {
  startTime: string;
  className?: string;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getColorClass(ms: number): string {
  const minutes = ms / 60000;
  if (minutes > 60) return 'text-red-400 animate-led-blink';
  if (minutes > 30) return 'text-amber-400';
  return 'text-green-400';
}

export default React.memo(function ElapsedTimer({ startTime, className = '' }: ElapsedTimerProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  // Use refs + direct DOM updates to avoid triggering React re-renders every second
  useEffect(() => {
    const start = new Date(startTime).getTime();
    if (isNaN(start)) return;

    let prevColorClass = '';
    const update = () => {
      const el = spanRef.current;
      if (!el) return;
      const ms = Date.now() - start;
      el.textContent = formatElapsed(ms);
      const newColor = getColorClass(ms);
      if (newColor !== prevColorClass) {
        if (prevColorClass) {
          prevColorClass.split(' ').forEach(c => el.classList.remove(c));
        }
        newColor.split(' ').forEach(c => el.classList.add(c));
        prevColorClass = newColor;
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Initial render values
  const initMs = (() => {
    const t = new Date(startTime).getTime();
    return isNaN(t) ? 0 : Date.now() - t;
  })();

  return (
    <span
      ref={spanRef}
      className={`font-mono font-bold ${getColorClass(initMs)} ${className}`}
    >
      {formatElapsed(initMs)}
    </span>
  );
});
