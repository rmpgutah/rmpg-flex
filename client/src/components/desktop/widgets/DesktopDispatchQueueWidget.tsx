import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface QueuedCall {
  id: number;
  call_number?: string;
  nature?: string;
  priority?: string | number;
  status?: string;
  created_at?: string;
}

function minutesWaiting(createdAt?: string): number {
  if (!createdAt) return 0;
  const ms = Date.now() - parseTimestamp(createdAt).getTime();
  return Math.floor(ms / 60_000);
}

function priorityNum(p: string | number | undefined): number {
  const v = parseInt(String(p ?? '9'), 10);
  return isNaN(v) ? 9 : v;
}

function rowBg(call: QueuedCall): string | undefined {
  const mins = minutesWaiting(call.created_at);
  const p = priorityNum(call.priority);
  if ((p === 1 && mins >= 5) || (p === 2 && mins >= 10)) {
    return 'rgba(239,68,68,0.12)';
  }
  return undefined;
}

function priorityLabel(p: string | number | undefined): string {
  return `P${String(p ?? '?')}`;
}

function priorityColor(p: string | number | undefined): string {
  const n = priorityNum(p);
  if (n === 1) return 'var(--sev-critical)';
  if (n === 2) return 'var(--sev-warn)';
  return 'var(--text-secondary)';
}

export default function DesktopDispatchQueueWidget() {
  const [calls, setCalls] = useState<QueuedCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const data = await apiFetch<QueuedCall[]>('/dispatch/calls?status=pending,queued&limit=10');
      setCalls(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ width: 260, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        DISPATCH QUEUE
      </div>
      {loading ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unable to load</div>
      ) : calls.length === 0 ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No pending calls</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {calls.map(c => {
            const mins = minutesWaiting(c.created_at);
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  padding: '2px 4px',
                  borderRadius: 2,
                  background: rowBg(c),
                }}
              >
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    color: priorityColor(c.priority),
                    border: `1px solid ${priorityColor(c.priority)}`,
                    borderRadius: 2,
                    padding: '0 2px',
                    flexShrink: 0,
                  }}
                >
                  {priorityLabel(c.priority)}
                </span>
                <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(c.nature ?? 'Unknown').slice(0, 20)}
                </span>
                <span style={{ fontSize: 8, color: mins > 0 ? 'var(--sev-warn)' : 'var(--text-secondary)', flexShrink: 0 }}>
                  {mins}m
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
