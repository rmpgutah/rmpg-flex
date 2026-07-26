import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function DesktopShiftTimerWidget() {
  const [clockIn, setClockIn] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ active: boolean; entry: { clock_in: string } | null }>('/personnel/time/mine/active')
      .then(res => { if (!cancelled) { setActive(res.active); setClockIn(res.entry?.clock_in ?? null); } })
      .catch(() => { if (!cancelled) setActive(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = active && clockIn ? formatElapsed(now - new Date(clockIn).getTime()) : null;

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 200 }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Shift Timer</div>
      {active === null ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>…</div>
      ) : active ? (
        <>
          <div className="text-[18px] font-mono" style={{ color: 'var(--text-primary)' }}>{elapsed}</div>
          <div className="text-[10px]" style={{ color: 'var(--brand-400)' }}>On Duty</div>
        </>
      ) : (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Off Duty</div>
      )}
    </div>
  );
}
