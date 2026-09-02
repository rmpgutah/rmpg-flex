import React, { useState, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface VehicleResult {
  id?: number;
  plate_number?: string;
  make?: string;
  model?: string;
  color?: string;
  color_primary?: string;
  year?: string | number;
  owner_name?: string;
  is_stolen?: boolean | number;
  stolen?: boolean | number;
  warrant_count?: number;
  warrants?: number;
}

const MAX_HISTORY = 5;

export default function DesktopPlateLookupWidget() {
  const [plate, setPlate] = useState('');
  const [result, setResult] = useState<VehicleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function lookup(query: string) {
    const cleaned = query.trim().toUpperCase();
    if (!cleaned) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowHistory(false);
    try {
      const data = await apiFetch<VehicleResult | VehicleResult[]>(`/vehicles/search?plate=${encodeURIComponent(cleaned)}`);
      const vehicle = Array.isArray(data) ? data[0] : data;
      setResult(vehicle ?? null);
      if (!vehicle) setError('No vehicle found');
      setHistory(prev => {
        const next = [cleaned, ...prev.filter(h => h !== cleaned)].slice(0, MAX_HISTORY);
        return next;
      });
    } catch {
      // Try fallback endpoint
      try {
        const data2 = await apiFetch<VehicleResult | VehicleResult[]>(`/vehicles?plate=${encodeURIComponent(cleaned)}`);
        const vehicle = Array.isArray(data2) ? data2[0] : data2;
        setResult(vehicle ?? null);
        if (!vehicle) setError('No vehicle found');
        setHistory(prev => {
          const next = [cleaned, ...prev.filter(h => h !== cleaned)].slice(0, MAX_HISTORY);
          return next;
        });
      } catch {
        setError('Unable to load');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    lookup(plate);
  }

  function handleHistorySelect(h: string) {
    setPlate(h);
    setShowHistory(false);
    lookup(h);
  }

  const isStolen = result && (result.is_stolen || result.stolen);
  const warrantCount = result ? (result.warrant_count ?? result.warrants ?? 0) : 0;

  return (
    <div style={{ width: 240, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        PLATE LOOKUP
      </div>
      <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            ref={inputRef}
            value={plate}
            onChange={e => setPlate(e.target.value.toUpperCase())}
            onFocus={() => history.length > 0 && setShowHistory(true)}
            onBlur={() => setTimeout(() => setShowHistory(false), 150)}
            placeholder="ABC123"
            style={{
              flex: 1,
              fontSize: 11,
              padding: '2px 5px',
              background: 'var(--surface-base)',
              border: '1px solid var(--border-default)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              outline: 'none',
              fontFamily: 'Arial, sans-serif',
              letterSpacing: '0.1em',
            }}
          />
          <button
            type="submit"
            disabled={loading || !plate.trim()}
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 7px',
              background: 'var(--accent-silver-400)',
              color: 'var(--surface-base)',
              border: 'none',
              borderRadius: 2,
              cursor: loading ? 'default' : 'pointer',
              opacity: !plate.trim() ? 0.5 : 1,
            }}
          >
            {loading ? '…' : 'GO'}
          </button>
        </div>
        {showHistory && history.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-default)',
            borderRadius: 2,
            zIndex: 100,
            marginTop: 2,
          }}>
            {history.map(h => (
              <div
                key={h}
                onMouseDown={() => handleHistorySelect(h)}
                style={{
                  fontSize: 10,
                  padding: '3px 6px',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  fontFamily: 'Arial, sans-serif',
                  letterSpacing: '0.08em',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-base)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {h}
              </div>
            ))}
          </div>
        )}
      </form>

      {error && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>{error}</div>
      )}

      {result && !error && (
        <div style={{ marginTop: 5, fontSize: 10 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
            {[result.year, result.make, result.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
          </div>
          {(result.color || result.color_primary) && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
              Color: {result.color ?? result.color_primary}
            </div>
          )}
          {result.owner_name && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
              Owner: {result.owner_name}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            {isStolen && (
              <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--sev-critical)', border: '1px solid var(--sev-critical)', borderRadius: 2, padding: '0 3px' }}>
                STOLEN
              </span>
            )}
            {warrantCount > 0 && (
              <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--sev-warn)', border: '1px solid var(--sev-warn)', borderRadius: 2, padding: '0 3px' }}>
                {warrantCount} WARRANT{warrantCount !== 1 ? 'S' : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
