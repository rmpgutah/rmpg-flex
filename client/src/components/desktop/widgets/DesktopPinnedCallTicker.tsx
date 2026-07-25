import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';

// Matches the real /dispatch/queue response shape — see ActiveCall in
// client/src/pages/map/utils/mapConstants.ts and LIST_VIEW_COLUMNS in
// src/routes/dispatch/calls.ts (projected as-is by src/routes/dispatch/aggregates.ts's
// GET /queue). There is no `call_type`/`address`; the DB columns are
// `incident_type`/`location_address`. `priority` isn't rendered here, so it's
// omitted rather than kept as an unused (and previously mistyped) field.
interface TickerCall {
  id: number | string;
  incident_type: string;
  location_address: string;
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
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Active Calls</div>
      {!loaded ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>…</div>
      ) : calls.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No active calls</div>
      ) : (
        calls.map(c => (
          <div key={c.id} className="text-[11px] py-0.5" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold">{c.incident_type}</span>
            <span style={{ color: 'var(--text-muted)' }}> — {c.location_address}</span>
          </div>
        ))
      )}
    </div>
  );
}
