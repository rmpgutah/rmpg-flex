import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../../hooks/useApi';

interface Warrant {
  id: number;
  status?: string;
  warrant_type?: string;
  type?: string;
}

interface BreakdownCounts {
  total: number;
  arrest: number;
  bench: number;
  civil: number;
}

function isActive(w: Warrant): boolean {
  const s = (w.status ?? '').toLowerCase();
  return s === 'active' || s === 'outstanding';
}

function warrantType(w: Warrant): string {
  return (w.warrant_type ?? w.type ?? '').toLowerCase();
}

function countColor(total: number): string {
  if (total < 10) return 'var(--sev-ok)';
  if (total <= 50) return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

export default function DesktopActiveWarrantsWidget() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<BreakdownCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchWarrants = useCallback(async () => {
    try {
      const resp = await apiFetch<{ data: Warrant[] } | Warrant[]>('/warrants?status=active&limit=200');
      const rows: Warrant[] = Array.isArray(resp) ? resp : ((resp as { data: Warrant[] }).data ?? []);
      const active = rows.filter(isActive);
      setCounts({
        total: active.length,
        arrest: active.filter(w => warrantType(w).includes('arrest')).length,
        bench: active.filter(w => warrantType(w).includes('bench')).length,
        civil: active.filter(w => warrantType(w).includes('civil')).length,
      });
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWarrants();
    const iv = setInterval(fetchWarrants, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchWarrants]);

  const color = counts ? countColor(counts.total) : 'var(--text-secondary)';

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 200,
        minHeight: 120,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
        Active Warrants
      </div>

      {loading ? (
        <div>
          <div style={{ background: 'var(--surface-base)', borderRadius: 2, height: 30, width: 60, marginBottom: 8 }} />
          <div style={{ background: 'var(--surface-base)', borderRadius: 2, height: 10, width: 140 }} />
        </div>
      ) : error ? (
        <div style={{ color: 'var(--sev-warn)', fontSize: 11 }}>Unable to load warrant data</div>
      ) : counts ? (
        <>
          <div className="font-mono font-bold" style={{ color, fontSize: 30, lineHeight: 1, letterSpacing: '-0.5px' }}>
            {counts.total}
          </div>
          <div className="flex gap-2 mt-2">
            {(
              [
                { label: 'Arrest', val: counts.arrest },
                { label: 'Bench', val: counts.bench },
                { label: 'Civil', val: counts.civil },
              ] as const
            ).map(({ label, val }) => (
              <div
                key={label}
                style={{
                  background: 'var(--surface-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 2,
                  padding: '1px 5px',
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: 36,
                }}
              >
                <span className="font-mono font-bold" style={{ color: 'var(--text-primary)', fontSize: 11 }}>{val}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate('/warrants')}
            style={{
              marginTop: 10,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--accent-silver-400)',
              fontSize: 10,
              padding: 0,
            }}
          >
            View All →
          </button>
        </>
      ) : null}
    </div>
  );
}
