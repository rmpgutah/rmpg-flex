import React, { useState, useCallback } from 'react';
import { Search, ChevronDown, ChevronRight, Flag } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { formatDate } from '../../../utils/dateUtils';
import { copyToClipboard } from '../../../utils/clipboard';
import { warrantDocketToCsv, downloadTextFile } from '../../../utils/rmsListExport';

interface Warrant {
  id: number;
  warrant_number?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  date_of_birth?: string;
  warrant_type?: string;
  type?: string;
  status?: string;
  charge?: string;
  issuing_court?: string;
  issue_date?: string;
  created_at?: string;
  notes?: string;
  bail_amount?: number;
}

type WarrantType = 'all' | 'arrest' | 'bench' | 'civil';
type WarrantStatus = 'all' | 'active' | 'served' | 'recalled';

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--sev-critical)',
  served: 'var(--sev-ok)',
  recalled: 'var(--sev-warn)',
};

function warrantName(w: Warrant): string {
  if (w.first_name || w.last_name) return [w.first_name, w.last_name].filter(Boolean).join(' ');
  return w.name ?? '—';
}

function warrantStatus(w: Warrant): string {
  return w.status ?? 'unknown';
}

function warrantType(w: Warrant): string {
  return w.warrant_type ?? w.type ?? '—';
}

interface Props {
  onClose?: () => void;
}

export default function DesktopWarrantSearch({ onClose: _onClose }: Props) {
  const [nameInput, setNameInput] = useState('');
  const [dobInput, setDobInput] = useState('');
  const [typeFilter, setTypeFilter] = useState<WarrantType>('all');
  const [statusFilter, setStatusFilter] = useState<WarrantStatus>('active');
  const [results, setResults] = useState<Warrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [flagging, setFlagging] = useState<number | null>(null);
  const [flagStatus, setFlagStatus] = useState<Record<number, string>>({});
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  const doSearch = useCallback(async (reset: boolean) => {
    setLoading(true);
    setError(null);
    const newOffset = reset ? 0 : offset;
    if (reset) setOffset(0);
    try {
      const params = new URLSearchParams();
      if (nameInput.trim()) params.set('name', nameInput.trim());
      if (dobInput.trim()) params.set('dob', dobInput.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (typeFilter !== 'all') params.set('type', typeFilter);
      params.set('limit', String(LIMIT));
      params.set('offset', String(newOffset));
      const data = await apiFetch<Warrant[] | { results?: Warrant[] }>(`/warrants?${params}`);
      const list = Array.isArray(data) ? data : (data.results ?? []);
      if (reset) {
        setResults(list);
      } else {
        setResults(prev => [...prev, ...list]);
      }
      setOffset(newOffset + list.length);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [nameInput, dobInput, typeFilter, statusFilter, offset]);

  const handleSearch = () => doSearch(true);

  const flagForService = async (id: number) => {
    setFlagging(id);
    try {
      await apiFetch(`/warrants/${id}/flag`, { method: 'POST' });
      setFlagStatus(prev => ({ ...prev, [id]: 'Flagged' }));
    } catch {
      setFlagStatus(prev => ({ ...prev, [id]: 'Failed' }));
    } finally {
      setFlagging(null);
    }
  };

  const selectStyle: React.CSSProperties = {
    fontSize: 11, padding: '4px 6px', background: 'var(--surface-sunken)',
    border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 2,
  };
  const th: React.CSSProperties = {
    textAlign: 'left', padding: '3px 8px', fontSize: 9, fontWeight: 700,
    color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em',
    borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '2px 8px', fontSize: 11, color: 'var(--text-primary)',
    borderBottom: '1px solid rgba(195,204,214,0.07)', verticalAlign: 'middle',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Search bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <Search size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)' }}>
          Warrant Search
        </span>
        <input
          type="text"
          placeholder="Name…"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{ ...selectStyle, flex: 1, minWidth: 120 }}
        />
        <input
          type="text"
          placeholder="DOB (YYYY-MM-DD)…"
          value={dobInput}
          onChange={e => setDobInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{ ...selectStyle, width: 140 }}
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as WarrantType)} style={selectStyle}>
          <option value="all">All Types</option>
          <option value="arrest">Arrest</option>
          <option value="bench">Bench</option>
          <option value="civil">Civil</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as WarrantStatus)} style={selectStyle}>
          <option value="active">Active</option>
          <option value="all">All Status</option>
          <option value="served">Served</option>
          <option value="recalled">Recalled</option>
        </select>
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          style={{
            fontSize: 11, padding: '4px 14px', borderRadius: 2, cursor: 'pointer',
            background: 'var(--surface-sunken)', border: '1px solid var(--accent-silver-400)',
            color: 'var(--text-primary)', fontWeight: 700,
          }}
        >Search</button>
        <button
          type="button"
          disabled={results.length === 0}
          onClick={() => downloadTextFile('warrant-docket.csv', warrantDocketToCsv(results))}
          style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 2, cursor: 'pointer',
            background: 'none', border: '1px solid var(--border-default)', color: 'var(--text-primary)',
          }}
        >CSV</button>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && results.length === 0 && <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>Searching…</p>}
        {error && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--sev-critical)' }}>
            {error}{' '}
            <button type="button" onClick={handleSearch} style={{ fontSize: 10, marginLeft: 8, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Retry</button>
          </p>
        )}
        {searched && !loading && results.length === 0 && !error && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>No warrants found</p>
        )}
        {results.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 24 }}></th>
                <th style={th}>Warrant #</th>
                <th style={th}>Name</th>
                <th style={th}>DOB</th>
                <th style={th}>Type</th>
                <th style={th}>Status</th>
                <th style={th}>Charge</th>
                <th style={th}>Court</th>
                <th style={th}>Issued</th>
              </tr>
            </thead>
            <tbody>
              {results.map(w => (
                <React.Fragment key={w.id}>
                  <tr
                    style={{ cursor: 'pointer', background: expanded === w.id ? 'var(--surface-raised)' : 'transparent' }}
                    onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                  >
                    <td style={{ ...td, color: 'var(--text-secondary)' }}>
                      {expanded === w.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td style={{ ...td, fontFamily: 'Arial, sans-serif', fontSize: 10 }}>{w.warrant_number ?? `#${w.id}`}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{warrantName(w)}</td>
                    <td style={td}>{w.date_of_birth ?? '—'}</td>
                    <td style={{ ...td, textTransform: 'capitalize' }}>{warrantType(w)}</td>
                    <td style={td}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 2,
                        background: STATUS_COLORS[warrantStatus(w)] ?? 'var(--surface-sunken)',
                        color: '#fff', textTransform: 'uppercase',
                      }}>
                        {warrantStatus(w)}
                      </span>
                    </td>
                    <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.charge ?? '—'}</td>
                    <td style={td}>{w.issuing_court ?? '—'}</td>
                    <td style={td}>{formatDate(w.issue_date ?? w.created_at) || '—'}</td>
                  </tr>
                  {expanded === w.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: '8px 16px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '4px 16px', fontSize: 11 }}>
                          {w.bail_amount != null && (
                            <>
                              <span style={{ color: 'var(--field-label-color)', fontWeight: 700 }}>Bail:</span>
                              <span style={{ color: 'var(--text-primary)' }}>${w.bail_amount.toLocaleString()}</span>
                            </>
                          )}
                          {w.notes && (
                            <>
                              <span style={{ color: 'var(--field-label-color)', fontWeight: 700 }}>Notes:</span>
                              <span style={{ color: 'var(--text-primary)', gridColumn: '2 / -1' }}>{w.notes}</span>
                            </>
                          )}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <button
                            type="button"
                            onClick={() => flagForService(w.id)}
                            disabled={flagging === w.id || !!flagStatus[w.id]}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px',
                              borderRadius: 2, border: '1px solid var(--sev-warn)', cursor: 'pointer',
                              background: 'none', color: 'var(--sev-warn)', fontWeight: 700,
                            }}
                          >
                            <Flag size={11} />
                            {flagStatus[w.id] ?? (flagging === w.id ? 'Flagging…' : 'Flag for Service')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        {results.length > 0 && results.length % LIMIT === 0 && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <button
              type="button"
              onClick={() => doSearch(false)}
              disabled={loading}
              style={{ fontSize: 10, padding: '3px 14px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-secondary)' }}
            >{loading ? 'Loading…' : 'Load more'}</button>
          </div>
        )}
      </div>

      <div style={{ padding: '4px 12px', background: 'var(--surface-raised)', borderTop: '1px solid var(--border-default)', fontSize: 9, color: 'var(--text-secondary)' }}>
        {searched ? `${results.length} result${results.length !== 1 ? 's' : ''}` : 'Enter criteria and press Search'}
      </div>
    </div>
  );
}
