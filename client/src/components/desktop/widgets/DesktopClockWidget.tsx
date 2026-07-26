import React, { useState, useEffect } from 'react';
import { useClock } from '../../../hooks/useClock';
import { apiFetch } from '../../../hooks/useApi';
import { safeTimeStr } from '../../../utils/dateUtils';

export default function DesktopClockWidget() {
  const { time, date } = useClock();
  const [active, setActive] = useState<boolean | null>(null);
  const [clockIn, setClockIn] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ active: boolean; entry: { clock_in: string } | null }>('/personnel/time/mine/active')
      .then(res => { if (!cancelled) { setActive(res.active); setClockIn(res.entry?.clock_in ?? null); } })
      .catch(() => { if (!cancelled) setActive(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 200 }}>
      <div className="text-[20px] font-mono" style={{ color: 'var(--text-primary)' }}>{time}</div>
      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{date}</div>
      <div className="mt-2 text-[10px] font-semibold" style={{ color: active ? 'var(--accent-active)' : 'var(--text-muted)' }}>
        {active === null ? '…' : active ? `On Duty since ${safeTimeStr(clockIn, '')}` : 'Off Duty'}
      </div>
    </div>
  );
}
