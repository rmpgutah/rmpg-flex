import React, { useState, useEffect, useCallback } from 'react';
import { Radio, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

interface CallUnit {
  unit_id?: string;
  unit_number?: string;
  agency?: string;
  officer_name?: string;
}

interface ActiveCall {
  id: number;
  call_number?: string;
  incident_number?: string;
  nature?: string;
  status?: string;
  location_address?: string;
  units?: CallUnit[];
  assigned_units?: CallUnit[];
}

interface MutualAidRow {
  callId: number;
  callNumber: string;
  nature: string;
  location: string;
  requestingAgency: string;
  assistingAgencies: string[];
  units: string[];
}

const RMPG_AGENCY = 'RMPG';

function extractAgency(unit: CallUnit): string {
  return unit.agency ?? (unit.unit_id?.split('-')[0] ?? RMPG_AGENCY);
}

function buildMutualAidRows(calls: ActiveCall[]): MutualAidRow[] {
  const rows: MutualAidRow[] = [];
  for (const call of calls) {
    const allUnits: CallUnit[] = [...(call.units ?? []), ...(call.assigned_units ?? [])];
    const externalUnits = allUnits.filter(u => extractAgency(u) !== RMPG_AGENCY);
    const agencies = [...new Set(externalUnits.map(extractAgency))];
    // Include all calls that have any units (may include mutual aid)
    rows.push({
      callId: call.id,
      callNumber: call.call_number ?? call.incident_number ?? String(call.id),
      nature: call.nature ?? '—',
      location: call.location_address ?? '—',
      requestingAgency: RMPG_AGENCY,
      assistingAgencies: agencies,
      units: allUnits.map(u => u.unit_id ?? u.unit_number ?? '?'),
    });
  }
  return rows;
}

interface Props {
  onClose?: () => void;
}

export default function DesktopMutualAidTracker({ onClose: _onClose }: Props) {
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ActiveCall[] | { results?: ActiveCall[] }>('/dispatch/calls?status=active&limit=50');
      setCalls(Array.isArray(data) ? data : (data.results ?? []));
      setLastRefreshed(new Date());
    } catch {
      // keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const rows = buildMutualAidRows(calls);
  const mutualAidRows = rows.filter(r => r.assistingAgencies.length > 0);
  const uniqueAgencies = [...new Set(mutualAidRows.flatMap(r => r.assistingAgencies))];

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '3px 8px', fontSize: 9, fontWeight: 700,
    color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em',
    borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    padding: '3px 8px', fontSize: 11, color: 'var(--text-primary)',
    borderBottom: '1px solid rgba(195,204,214,0.07)', verticalAlign: 'middle',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <Radio size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Mutual Aid Tracker
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Refresh"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)' }}
        >
          <RefreshCw size={10} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
        </button>
      </div>

      {/* Summary stats */}
      {mutualAidRows.length > 0 && (
        <div style={{ display: 'flex', gap: 16, padding: '6px 12px', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{mutualAidRows.flatMap(r => r.units).length}</strong> mutual aid units
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{uniqueAgencies.length}</strong> agenc{uniqueAgencies.length !== 1 ? 'ies' : 'y'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{mutualAidRows.length}</strong> call{mutualAidRows.length !== 1 ? 's' : ''}
          </span>
          {lastRefreshed && (
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Table / empty state */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && mutualAidRows.length === 0 && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>Loading…</p>
        )}
        {!loading && mutualAidRows.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <Radio size={32} style={{ color: 'var(--border-default)' }} />
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>No mutual aid currently active</p>
            {lastRefreshed && <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0 }}>Last checked {lastRefreshed.toLocaleTimeString()}</p>}
          </div>
        )}
        {mutualAidRows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Call #</th>
                <th style={th}>Nature</th>
                <th style={th}>Location</th>
                <th style={th}>Requesting</th>
                <th style={th}>Assisting Agencies</th>
                <th style={th}>Units</th>
              </tr>
            </thead>
            <tbody>
              {mutualAidRows.map(r => (
                <tr key={r.callId}>
                  <td style={{ ...td, fontFamily: 'Arial, sans-serif', fontSize: 10, fontWeight: 700 }}>{r.callNumber}</td>
                  <td style={td}>{r.nature}</td>
                  <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.location}</td>
                  <td style={{ ...td, fontSize: 10, fontWeight: 700, color: 'var(--accent-silver-400)' }}>{r.requestingAgency}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {r.assistingAgencies.map(ag => (
                        <span key={ag} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 2, background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', fontWeight: 700 }}>
                          {ag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...td, fontFamily: 'Arial, sans-serif', fontSize: 10, color: 'var(--text-secondary)' }}>
                    {r.units.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '4px 12px', background: 'var(--surface-raised)', borderTop: '1px solid var(--border-default)', fontSize: 9, color: 'var(--text-secondary)' }}>
        Auto-refreshes every 60 s
      </div>
    </div>
  );
}
