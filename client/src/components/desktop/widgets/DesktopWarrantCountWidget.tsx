import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../../hooks/useApi';

interface Warrant {
  id: number;
  status?: string;
  charge_level?: string;
  severity?: string;
}

interface WarrantCounts {
  total: number;
  felony: number;
  misdemeanor: number;
}

function countColor(total: number): string {
  if (total === 0) return 'var(--text-secondary)';
  if (total <= 5) return 'var(--sev-warn)';
  return 'var(--sev-critical)';
}

function isActive(w: Warrant): boolean {
  const s = (w.status ?? '').toLowerCase();
  return s === 'active' || s === 'outstanding';
}

function isFelony(w: Warrant): boolean {
  const cl = (w.charge_level ?? w.severity ?? '').toLowerCase();
  return cl.includes('felony') || cl === 'f';
}

function isMisdemeanor(w: Warrant): boolean {
  const cl = (w.charge_level ?? w.severity ?? '').toLowerCase();
  return cl.includes('misdemeanor') || cl === 'm';
}

export default function DesktopWarrantCountWidget() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<WarrantCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchWarrants = useCallback(async () => {
    try {
      const resp = await apiFetch<{ data: Warrant[] } | Warrant[]>('/warrants');
      const rows: Warrant[] = Array.isArray(resp) ? resp : (resp as { data: Warrant[] }).data ?? [];
      const active = rows.filter(isActive);
      setCounts({
        total: active.length,
        felony: active.filter(isFelony).length,
        misdemeanor: active.filter(isMisdemeanor).length,
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
    const iv = setInterval(fetchWarrants, 60000);
    return () => clearInterval(iv);
  }, [fetchWarrants]);

  const handleClick = () => {
    navigate('/warrants');
  };

  const color = counts ? countColor(counts.total) : 'var(--text-secondary)';

  return (
    <button
      onClick={handleClick}
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 2,
        padding: '10px 14px',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        display: 'block',
      }}
      aria-label="Open Warrants module"
    >
      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
          <div
            style={{
              background: 'var(--surface-base)',
              borderRadius: 2,
              height: 28,
              width: 120,
              marginBottom: 6,
              animation: 'pulse 1.4s ease-in-out infinite',
            }}
          />
          <div
            style={{
              background: 'var(--surface-base)',
              borderRadius: 2,
              height: 11,
              width: 90,
            }}
          />
        </div>
      ) : error ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Warrants
          </div>
          <div style={{ color: 'var(--sev-warn)', fontSize: 11 }}>Unavailable</div>
        </div>
      ) : counts ? (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Active Warrants
          </div>
          <div
            className="font-mono font-bold"
            style={{ color, fontSize: 26, lineHeight: 1, letterSpacing: '-0.5px' }}
          >
            {counts.total}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-wider mt-0.5" style={{ color, opacity: 0.85 }}>
            {counts.total === 1 ? 'ACTIVE WARRANT' : 'ACTIVE WARRANTS'}
          </div>
          {(counts.felony > 0 || counts.misdemeanor > 0) && (
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
              {counts.felony > 0 && (
                <span style={{ marginRight: 8 }}>
                  <span className="font-mono font-bold" style={{ color: 'var(--sev-critical)' }}>{counts.felony}</span>
                  {' felony'}
                </span>
              )}
              {counts.misdemeanor > 0 && (
                <span>
                  <span className="font-mono font-bold" style={{ color: 'var(--sev-warn)' }}>{counts.misdemeanor}</span>
                  {' misd.'}
                </span>
              )}
            </div>
          )}
        </div>
      ) : null}
    </button>
  );
}
