import React, { useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';

interface AddressResult {
  call_count?: number;
  person_count?: number;
  parcel_owner?: string;
  owner?: string;
  address?: string;
  total?: number;
}

interface CallRecord {
  id: number;
  address?: string;
  nature?: string;
}

export default function DesktopAddressLookupWidget() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AddressResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(q: string) {
    const cleaned = q.trim();
    if (!cleaned) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Try geography/address lookup first
      const geo = await apiFetch<AddressResult>(`/geography/address?q=${encodeURIComponent(cleaned)}`);
      setResult(geo ?? null);
      if (!geo) setError('No results found');
    } catch {
      // Fallback: search recent calls for address matches
      try {
        const calls = await apiFetch<CallRecord[]>(`/dispatch/calls?address_contains=${encodeURIComponent(cleaned)}&limit=5`);
        const list = Array.isArray(calls) ? calls : [];
        setResult({
          call_count: list.length,
          address: cleaned,
        });
        if (list.length === 0) setError('No results found');
      } catch {
        setError('Unable to load');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    lookup(query);
  }

  return (
    <div style={{ width: 240, padding: '6px 8px', background: 'var(--surface-raised)', border: '1px solid var(--border-default)', borderRadius: 2 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
        ADDRESS LOOKUP
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="123 Main St"
            style={{
              flex: 1,
              fontSize: 10,
              padding: '2px 5px',
              background: 'var(--surface-base)',
              border: '1px solid var(--border-default)',
              borderRadius: 2,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading || !query.trim()}
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: '2px 7px',
              background: 'var(--accent-silver-400)',
              color: 'var(--surface-base)',
              border: 'none',
              borderRadius: 2,
              cursor: loading ? 'default' : 'pointer',
              opacity: !query.trim() ? 0.5 : 1,
            }}
          >
            {loading ? '…' : 'GO'}
          </button>
        </div>
      </form>

      {error && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 4 }}>{error}</div>
      )}

      {result && !error && (
        <div style={{ marginTop: 5, fontSize: 10 }}>
          {result.address && (
            <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3, fontSize: 9, wordBreak: 'break-word' }}>
              {result.address}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(result.call_count !== undefined || result.total !== undefined) && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
                Calls on file: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{result.call_count ?? result.total ?? 0}</span>
              </div>
            )}
            {result.person_count !== undefined && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
                Known persons: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{result.person_count}</span>
              </div>
            )}
            {(result.parcel_owner || result.owner) && (
              <div style={{ color: 'var(--text-secondary)', fontSize: 9 }}>
                Parcel owner: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{result.parcel_owner ?? result.owner}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
