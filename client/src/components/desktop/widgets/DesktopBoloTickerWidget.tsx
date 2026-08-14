import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface BoloCall {
  id: number;
  call_number?: string;
  nature?: string;
  priority?: string | number;
  status?: string;
}

function priorityColor(p: string | number | undefined): string {
  const v = String(p ?? '').toUpperCase();
  if (v === '1' || v === 'P1') return 'var(--sev-critical)';
  if (v === '2' || v === 'P2') return 'var(--sev-warn)';
  return 'var(--text-secondary)';
}

export default function DesktopBoloTickerWidget() {
  const [calls, setCalls] = useState<BoloCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const tickerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const data = await apiFetch<BoloCall[]>('/dispatch/calls?status=active&limit=20');
      const bolo = (Array.isArray(data) ? data : []).filter(c =>
        c.nature?.toUpperCase().includes('BOLO') || c.priority === 1 || c.priority === '1'
      );
      setCalls(bolo);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  const items = calls.length > 0 ? calls : [];
  const tickerText = items.length === 0
    ? 'No active BOLOs'
    : items.map(c => `[${c.call_number ?? c.id}] ${c.nature ?? 'BOLO'}`).join('   ◆   ');

  return (
    <div style={{ width: 320, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        BOLO TICKER
      </div>
      {loading ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unable to load</div>
      ) : (
        <div
          style={{ overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'default' }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div
            ref={tickerRef}
            style={{
              display: 'inline-block',
              fontSize: 10,
              color: items.length === 0 ? 'var(--text-secondary)' : 'var(--text-primary)',
              animation: items.length > 0 && !paused ? 'bolo-scroll 20s linear infinite' : 'none',
              paddingLeft: items.length > 0 ? '100%' : 0,
            }}
          >
            {tickerText}
          </div>
          <style>{`
            @keyframes bolo-scroll {
              from { transform: translateX(0); }
              to { transform: translateX(-100%); }
            }
          `}</style>
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {items.slice(0, 4).map(c => (
            <span
              key={c.id}
              style={{
                fontSize: 8,
                fontWeight: 700,
                color: priorityColor(c.priority),
                border: `1px solid ${priorityColor(c.priority)}`,
                borderRadius: 2,
                padding: '0 3px',
              }}
            >
              {c.call_number ?? `#${c.id}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
