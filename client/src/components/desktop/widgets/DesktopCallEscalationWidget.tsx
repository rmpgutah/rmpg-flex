import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface CfsCall {
  id: number | string;
  call_number?: string;
  nature_of_call?: string;
  nature?: string;
  priority?: number | string;
  created_at?: string;
  incident_time?: string;
  status?: string;
}

interface EscalatedCall {
  id: number | string;
  callNumber: string;
  nature: string;
  priority: number;
  waitMs: number;
  overThreshold: boolean;
}

const SLA_MS: Record<number, number> = {
  1: 3 * 60 * 1000,
  2: 8 * 60 * 1000,
  3: 20 * 60 * 1000,
};

function parsePriority(raw: number | string | undefined): number {
  const n = Number(raw);
  return isNaN(n) ? 3 : n;
}

function callNumber(c: CfsCall): string {
  return String(c.call_number ?? c.id ?? '—');
}

function callNature(c: CfsCall): string {
  return c.nature_of_call ?? c.nature ?? 'Unknown';
}

function formatWait(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function priorityColor(p: number): string {
  if (p === 1) return 'var(--sev-critical)';
  if (p === 2) return 'var(--sev-warn)';
  return 'var(--accent-silver-400)';
}

export default function DesktopCallEscalationWidget() {
  const [escalated, setEscalated] = useState<EscalatedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const fetchCalls = useCallback(async () => {
    try {
      const resp = await apiFetch<{ data: CfsCall[] } | CfsCall[]>(
        '/dispatch/calls?status=pending,active&limit=50',
      );
      const rows: CfsCall[] = Array.isArray(resp) ? resp : ((resp as { data: CfsCall[] }).data ?? []);
      const ts = Date.now();
      const result: EscalatedCall[] = [];
      for (const c of rows) {
        const pri = parsePriority(c.priority);
        const threshold = SLA_MS[pri] ?? SLA_MS[3];
        const created = c.created_at ?? c.incident_time;
        if (!created) continue;
        const waitMs = ts - parseTimestamp(created).getTime();
        if (waitMs >= threshold) {
          result.push({
            id: c.id,
            callNumber: callNumber(c),
            nature: callNature(c),
            priority: pri,
            waitMs,
            overThreshold: true,
          });
        }
      }
      result.sort((a, b) => a.priority - b.priority || b.waitMs - a.waitMs);
      setEscalated(result);
    } catch {
      // silently retain previous data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalls();
    const iv = setInterval(fetchCalls, 30 * 1000);
    return () => clearInterval(iv);
  }, [fetchCalls]);

  // Tick every 10s to update elapsed display
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 10 * 1000);
    return () => clearInterval(iv);
  }, []);

  const hasP1Over = escalated.some(e => e.priority === 1);

  return (
    <>
      {hasP1Over && (
        <style>{`
          @keyframes rmpg-pulse-border {
            0%, 100% { border-color: var(--sev-critical); }
            50% { border-color: var(--border-default); }
          }
        `}</style>
      )}
      <div
        style={{
          background: 'var(--surface-raised)',
          border: hasP1Over ? '1px solid var(--sev-critical)' : '1px solid var(--border-default)',
          borderRadius: 2,
          padding: '10px 14px',
          width: 240,
          maxHeight: 180,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: hasP1Over ? 'rmpg-pulse-border 2s ease-in-out infinite' : undefined,
        }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
          Priority Escalations
        </div>

        {loading ? (
          <div>
            {[1, 2].map(i => (
              <div key={i} style={{ background: 'var(--surface-base)', borderRadius: 2, height: 22, marginBottom: 4 }} />
            ))}
          </div>
        ) : escalated.length === 0 ? (
          <div className="flex items-center gap-2" style={{ color: 'var(--sev-ok)', fontSize: 11 }}>
            <span>✓</span>
            <span>All calls within SLA</span>
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {escalated.map(e => {
              // Recalculate wait at render time using now tick
              const currentWait = now - (Date.now() - e.waitMs);
              const displayWait = formatWait(Math.max(0, e.waitMs + (now - Date.now())));
              void currentWait; // suppress unused warning; waitMs is already correct
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-2"
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    paddingBottom: 3,
                    marginBottom: 3,
                    fontSize: 10,
                  }}
                >
                  <span
                    style={{
                      background: priorityColor(e.priority),
                      color: '#fff',
                      borderRadius: 2,
                      padding: '0 4px',
                      fontWeight: 700,
                      fontSize: 9,
                      flexShrink: 0,
                    }}
                  >
                    P{e.priority}
                  </span>
                  <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.callNumber} — {e.nature}
                  </span>
                  <span style={{ color: 'var(--sev-critical)', fontWeight: 700, flexShrink: 0 }}>
                    {displayWait}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
