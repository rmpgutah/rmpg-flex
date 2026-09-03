import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp } from '../../../utils/dateUtils';

interface RadioEntry {
  id: number;
  call_number?: string;
  nature?: string;
  status?: string;
  updated_at?: string;
  created_at?: string;
}

function formatTime(ts?: string): string {
  if (!ts) return '--:--';
  const d = parseTimestamp(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function DesktopRadioLogWidget() {
  const [entries, setEntries] = useState<RadioEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  async function load() {
    try {
      const data = await apiFetch<RadioEntry[]>('/dispatch/calls?limit=20&sort=updated_at');
      const list = Array.isArray(data) ? data : [];
      setEntries(list);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  // Auto-scroll to bottom on new entries, unless paused
  useEffect(() => {
    if (!paused && listRef.current && entries.length !== prevCountRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    prevCountRef.current = entries.length;
  }, [entries, paused]);

  return (
    <div style={{ width: 260, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          RADIO LOG
        </span>
        {!loading && !error && (
          <span style={{ fontSize: 8, color: 'var(--text-secondary)' }}>
            {entries.length} entries
          </span>
        )}
      </div>
      {loading ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unable to load</div>
      ) : entries.length === 0 ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No recent activity</div>
      ) : (
        <div
          ref={listRef}
          style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {entries.map(e => (
            <div
              key={e.id}
              style={{
                display: 'flex',
                gap: 5,
                fontSize: 9,
                padding: '1px 0',
                borderBottom: '1px solid var(--border-default)',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0, fontFamily: 'Arial, sans-serif', fontSize: 8 }}>
                {formatTime(e.updated_at ?? e.created_at)}
              </span>
              <span style={{ color: 'var(--accent-silver-400)', flexShrink: 0, fontWeight: 700 }}>
                {e.call_number ?? `#${e.id}`}
              </span>
              <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.nature ?? '—'}
              </span>
              {e.status && (
                <span style={{ color: 'var(--text-secondary)', fontSize: 8, flexShrink: 0, textTransform: 'uppercase' }}>
                  {e.status.slice(0, 8)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
