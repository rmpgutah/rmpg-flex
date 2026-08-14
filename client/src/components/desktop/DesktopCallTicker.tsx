import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../hooks/useApi';

interface TickerCall {
  id: number | string;
  incident_type: string;
  location_address: string;
  priority?: number | string;
}

function priorityColor(p: number | string | undefined): string {
  const n = Number(p);
  if (n === 1) return 'var(--sev-critical, #ef4444)';
  if (n === 2) return 'var(--sev-high, #f97316)';
  if (n === 3) return 'var(--sev-medium, #f59e0b)';
  return 'var(--text-primary, #f0f4f9)';
}

const SCROLL_PX_PER_S = 60;

interface DesktopCallTickerProps {
  onOpenCall?: (id: number | string) => void;
}

export default function DesktopCallTicker({ onOpenCall }: DesktopCallTickerProps) {
  const [calls, setCalls] = useState<TickerCall[]>([]);
  const [paused, setPaused] = useState(false);
  const offsetRef = useRef(0);
  const lastTsRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      apiFetch<TickerCall[]>('/dispatch/queue')
        .then(rows => { if (!cancelled && Array.isArray(rows)) setCalls(rows); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (paused || calls.length === 0) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTsRef.current = 0;
      return;
    }

    function tick(ts: number) {
      if (lastTsRef.current === 0) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      offsetRef.current += SCROLL_PX_PER_S * dt;

      const el = trackRef.current;
      if (el) {
        const totalW = el.scrollWidth / 2; // duplicated content
        if (offsetRef.current >= totalW) offsetRef.current -= totalW;
        el.style.transform = `translateX(-${offsetRef.current}px)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [paused, calls.length]);

  if (calls.length === 0) return null;

  // Duplicate the list so the marquee loops seamlessly
  const items = [...calls, ...calls];

  return (
    <div
      style={{ height: 22, background: 'var(--surface-base, #22405f)', borderTop: '1px solid var(--border-subtle, rgba(195,204,214,0.08))', overflow: 'hidden', position: 'relative', flexShrink: 0 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Active calls ticker"
    >
      <div ref={trackRef} style={{ display: 'flex', alignItems: 'center', height: '100%', willChange: 'transform', whiteSpace: 'nowrap' }}>
        {items.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onOpenCall?.(c.id)}
            title={`${c.incident_type} — ${c.location_address}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 18px', height: '100%', border: 'none',
              background: 'none', cursor: 'pointer',
              borderRight: '1px solid var(--border-subtle, rgba(195,204,214,0.08))',
            }}
          >
            {c.priority != null && (
              <span style={{ fontSize: 8, fontWeight: 700, color: priorityColor(c.priority), letterSpacing: '0.06em' }}>
                P{c.priority}
              </span>
            )}
            <span style={{ fontSize: 10, fontWeight: 600, color: priorityColor(c.priority) }}>
              {c.incident_type?.replace(/_/g, ' ') ?? 'Call'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-secondary, #adbccc)' }}>
              — {c.location_address}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
