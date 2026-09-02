import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { parseTimestamp } from '../../../utils/dateUtils';

interface ShiftCall {
  id: number;
  status?: string;
  created_at?: string;
  dispatched_at?: string;
  closed_at?: string;
  priority?: string | number;
}

interface ShiftStats {
  total: number;
  active: number;
  avgResponseMin: number | null;
}

function computeStats(calls: ShiftCall[]): ShiftStats {
  const total = calls.length;
  const active = calls.filter(c => {
    const s = (c.status ?? '').toLowerCase();
    return s === 'active' || s === 'dispatched' || s === 'en route';
  }).length;

  const responseTimes: number[] = [];
  for (const c of calls) {
    if (c.created_at && c.dispatched_at) {
      const diff = parseTimestamp(c.dispatched_at).getTime() - parseTimestamp(c.created_at).getTime();
      if (diff > 0) responseTimes.push(diff / 60_000);
    }
  }

  const avgResponseMin = responseTimes.length > 0
    ? Math.round((responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) * 10) / 10
    : null;

  return { total, active, avgResponseMin };
}

export default function DesktopShiftPerfWidget() {
  const { user } = useAuth();
  const [stats, setStats] = useState<ShiftStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const endpoint = user?.id
        ? `/dispatch/calls?assigned_officer=${encodeURIComponent(String(user.id))}&date=${today}&limit=100`
        : `/dispatch/calls?date=${today}&limit=100`;
      const data = await apiFetch<ShiftCall[]>(endpoint);
      const calls = Array.isArray(data) ? data : [];
      setStats(computeStats(calls));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 5 * 60_000);
    return () => clearInterval(iv);
  }, [user?.id]);

  return (
    <div style={{ width: 180, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        SHIFT PERFORMANCE
      </div>
      {loading ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Loading…</div>
      ) : error ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Unable to load</div>
      ) : stats ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Calls Handled</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Arial, sans-serif' }}>
              {stats.total}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Active Now</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: stats.active > 0 ? 'var(--sev-warn)' : 'var(--text-primary)', fontFamily: 'Arial, sans-serif' }}>
              {stats.active}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>Avg Response</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'Arial, sans-serif' }}>
              {stats.avgResponseMin !== null ? `${stats.avgResponseMin}m` : '—'}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No data</div>
      )}
    </div>
  );
}
