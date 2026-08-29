import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Download, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp, formatDateTime } from '../../../utils/dateUtils';
import { copyToClipboard } from '../../../utils/clipboard';
import { alprCapturesToCsv, downloadTextFile } from '../../../utils/rmsListExport';

interface AlprCapture {
  id: number;
  captured_at: string;
  plate_number?: string;
  make?: string;
  model?: string;
  color?: string;
  confidence?: number;
  is_stolen?: boolean | number;
  call_id?: number;
  field_photo_id?: number;
  vehicle_count?: number;
}

type DateRange = 'today' | '7d' | '30d';

function formatDateRange(range: DateRange): string {
  const now = new Date();
  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // new-date-ok local wall-clock
    return start.toISOString();
  }
  const days = range === '7d' ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function exportCsv(rows: AlprCapture[]) {
  downloadTextFile(`alpr-history-${Date.now()}.csv`, alprCapturesToCsv(rows));
}

interface Props {
  onClose?: () => void;
}

export default function DesktopAlprHistory({ onClose: _onClose }: Props) {
  const [captures, setCaptures] = useState<AlprCapture[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [stolenOnly, setStolenOnly] = useState(false);
  const [minConfidence, setMinConfidence] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [plateQ, setPlateQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AlprCapture[]>('/alpr/captures?limit=100');
      setCaptures(Array.isArray(data) ? data : []);
    } catch (e) {
      setError('ALPR data unavailable');
      setCaptures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const since = formatDateRange(dateRange);
  const filtered = captures.filter(c => {
    if (parseTimestamp(c.captured_at) < parseTimestamp(since)) return false;
    if (stolenOnly && !c.is_stolen) return false;
    const conf = c.confidence != null ? c.confidence * 100 : 100;
    if (conf < minConfidence) return false;
    if (plateQ.trim() && !(c.plate_number ?? '').toLowerCase().includes(plateQ.trim().toLowerCase())) return false;
    return true;
  });
  const filterActive = stolenOnly || minConfidence > 0 || dateRange !== 'today' || !!plateQ.trim();

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
      {/* Filter bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <Camera size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', marginRight: 8 }}>
          ALPR Capture History
        </span>
        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {(['today', '7d', '30d'] as DateRange[]).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDateRange(d)}
              style={{
                fontSize: 9, padding: '2px 8px', borderRadius: 2, cursor: 'pointer',
                border: `1px solid ${dateRange === d ? 'var(--accent-silver-400)' : 'var(--border-default)'}`,
                background: dateRange === d ? 'var(--surface-sunken)' : 'none',
                color: dateRange === d ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >{d}</button>
          ))}
        </div>
        <input
          type="search"
          value={plateQ}
          onChange={(e) => setPlateQ(e.target.value)}
          placeholder="Plate…"
          aria-label="Filter by plate"
          style={{ fontSize: 11, padding: '3px 8px', width: 100, background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={stolenOnly} onChange={e => setStolenOnly(e.target.checked)} />
          Stolen only
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-secondary)' }}>
          <span>Conf&ge;{minConfidence}%</span>
          <input
            type="range" min={0} max={100} value={minConfidence}
            onChange={e => setMinConfidence(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </div>
        <button
          type="button"
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 10px',
            borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer',
            background: 'none', color: 'var(--text-primary)',
          }}
        >
          <Download size={10} /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>Loading…</p>}
        {error && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--sev-critical)' }}>
            {error}{' '}
            <button type="button" onClick={() => void load()} style={{ fontSize: 10, marginLeft: 8, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Retry</button>
          </p>
        )}
        {!loading && !error && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 24 }}></th>
                <th style={th}>Timestamp</th>
                <th style={th}>Plate</th>
                <th style={th}>Make / Model</th>
                <th style={th}>Color</th>
                <th style={th}>Conf%</th>
                <th style={th}>Stolen?</th>
                <th style={th}>Call ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: 'var(--text-secondary)', paddingTop: 32 }}>
                  {captures.length === 0 ? 'No captures on file' : filterActive ? 'No captures matching filters' : 'No captures'}
                </td></tr>
              )}
              {filtered.map(c => (
                <React.Fragment key={c.id}>
                  <tr
                    style={{ cursor: 'pointer', background: expanded === c.id ? 'var(--surface-raised)' : 'transparent' }}
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    <td style={{ ...td, color: 'var(--text-secondary)' }}>
                      {expanded === c.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td style={td}>{formatDateTime(c.captured_at)}</td>
                    <td style={{ ...td, fontWeight: 700, fontFamily: 'monospace' }}>
                      {c.plate_number ?? '—'}
                      {c.plate_number && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); void copyToClipboard(c.plate_number ?? ''); }}
                          style={{ marginLeft: 6, fontSize: 9, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Copy</button>
                      )}
                    </td>
                    <td style={td}>{[c.make, c.model].filter(Boolean).join(' ') || '—'}</td>
                    <td style={td}>{c.color ?? '—'}</td>
                    <td style={td}>{c.confidence != null ? `${Math.round(c.confidence * 100)}%` : '—'}</td>
                    <td style={td}>
                      {c.is_stolen
                        ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--sev-critical)', fontSize: 10, fontWeight: 700 }}><AlertTriangle size={10} /> YES</span>
                        : <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>—</span>}
                    </td>
                    <td style={td}>{c.call_id ?? '—'}</td>
                  </tr>
                  {expanded === c.id && (
                    <tr>
                      <td colSpan={8} style={{ padding: '8px 16px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', fontSize: 11 }}>
                          <span style={{ color: 'var(--field-label-color)', fontWeight: 700 }}>Capture ID:</span>
                          <span style={{ color: 'var(--text-primary)' }}>{c.id}</span>
                          <span style={{ color: 'var(--field-label-color)', fontWeight: 700 }}>Vehicles in frame:</span>
                          <span style={{ color: 'var(--text-primary)' }}>{c.vehicle_count ?? 1}</span>
                          {c.call_id && (
                            <>
                              <span style={{ color: 'var(--field-label-color)', fontWeight: 700 }}>Linked call:</span>
                              <span style={{ color: 'var(--accent-silver-400)' }}>#{c.call_id}</span>
                            </>
                          )}
                          {c.field_photo_id && (
                            <>
                              <span style={{ color: 'var(--field-label-color)', fontWeight: 700 }}>Photo ID:</span>
                              <span style={{ color: 'var(--text-primary)' }}>{c.field_photo_id}</span>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '4px 12px', background: 'var(--surface-raised)', borderTop: '1px solid var(--border-default)', fontSize: 9, color: 'var(--text-secondary)' }}>
        {filtered.length} capture{filtered.length !== 1 ? 's' : ''} shown
      </div>
    </div>
  );
}
