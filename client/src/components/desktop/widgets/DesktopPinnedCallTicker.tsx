import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface TickerCall {
  id: number | string;
  call_type: string;
  address: string;
  priority: number;
}

export default function DesktopPinnedCallTicker() {
  const [calls, setCalls] = useState<TickerCall[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      apiFetch<TickerCall[]>('/dispatch/queue')
        .then(rows => { if (!cancelled) { setCalls(Array.isArray(rows) ? rows : []); setLoaded(true); } })
        .catch(() => { if (!cancelled) setLoaded(true); });
    }
    poll();
    const interval = setInterval(poll, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return (
    <div className="p-3" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-default)', width: 220, maxHeight: 160, overflowY: 'auto' }}>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--rmpg-400)' }}>Active Calls</div>
      {!loaded ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>…</div>
      ) : calls.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No active calls</div>
      ) : (
        calls.map(c => (
          <div key={c.id} className="text-[11px] py-0.5" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold">{c.call_type}</span>
            <span style={{ color: 'var(--text-muted)' }}> — {c.address}</span>
          </div>
        ))
      )}
    </div>
  );
}
