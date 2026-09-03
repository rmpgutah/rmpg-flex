import React, { useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, RefreshCw, Copy, Download } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { errorLogsToCsv, downloadTextFile } from '../../../utils/rmsListExport';
import { copyToClipboard } from '../../../utils/contextMenuActions';

const W = 720;
const H = 520;

interface DesktopEventViewerProps {
  onClose: () => void;
}

interface ErrorLogRow {
  id: number;
  created_at: string;
  severity: 'error' | 'warn' | 'info';
  category: string;
  message: string;
  source?: string;
  trace_id?: string;
  status_code?: number;
}

type SeverityFilter = 'all' | 'error' | 'warn' | 'info';

function severityColor(s: string): string {
  if (s === 'error') return 'var(--sev-critical)';
  if (s === 'warn') return 'var(--sev-warn)';
  return 'var(--accent-silver-400)';
}

function SeverityBadge({ sev }: { sev: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 2,
      border: `1px solid ${severityColor(sev)}`,
      color: severityColor(sev),
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {sev}
    </span>
  );
}

function ApiErrorsTab({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sevFilter, setSevFilter] = useState<SeverityFilter>('all');
  const [catFilter, setCatFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accessDenied, setAccessDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isAdmin) { setAccessDenied(true); return; }
    setLoading(true);
    setLoadError(null);
    apiFetch<ErrorLogRow[]>('/errors?limit=100&sort=created_at_desc')
      .then(data => { setRows(Array.isArray(data) ? data : []); setAccessDenied(false); })
      .catch((err: unknown) => {
        const status = (err as { status?: number })?.status;
        if (status === 403 || status === 401) setAccessDenied(true);
        setRows([]);
        setLoadError(err instanceof Error ? err.message : 'Failed to load errors');
      })
      .finally(() => setLoading(false));
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r => {
    if (sevFilter !== 'all' && r.severity !== sevFilter) return false;
    if (catFilter && !r.category.toLowerCase().includes(catFilter.toLowerCase())) return false;
    if (dateFrom && r.created_at < dateFrom) return false;
    if (dateTo && r.created_at > dateTo + 'T23:59:59') return false;
    return true;
  });

  const exportCsv = useCallback(() => {
    downloadTextFile(`api-errors-${Date.now()}.csv`, errorLogsToCsv(filtered));
  }, [filtered]);

  const inputStyle: React.CSSProperties = { fontSize: 10, padding: '3px 6px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' };

  if (accessDenied) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Admin or Manager role required to view API error log.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value as SeverityFilter)} style={inputStyle}>
          <option value="all">All severities</option>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
        </select>
        <input value={catFilter} onChange={e => setCatFilter(e.target.value)} placeholder="Category filter…" style={{ ...inputStyle, width: 120 }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>–</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle }} />
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={exportCsv} disabled={filtered.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)', opacity: filtered.length === 0 ? 0.4 : 1 }}>
          <Download size={10} /> Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
            {loadError
              ? loadError
              : rows.length === 0
                ? 'No log entries loaded.'
                : 'No log entries match the current filter.'}
            {loadError && (
              <div><button type="button" onClick={load} style={{ marginTop: 8, fontSize: 10, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Retry</button></div>
            )}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-sunken)', zIndex: 1 }}>
              <tr>
                {['Timestamp', 'Sev', 'Category', 'Message', 'Source', 'Trace ID'].map(h => (
                  <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '3px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontFamily: 'Arial, sans-serif', fontSize: 10 }}>{r.created_at?.slice(0, 19).replace('T', ' ') ?? '—'}</td>
                  <td style={{ padding: '3px 8px' }}><SeverityBadge sev={r.severity} /></td>
                  <td style={{ padding: '3px 8px', color: 'var(--text-secondary)' }}>{r.category}</td>
                  <td style={{ padding: '3px 8px', color: 'var(--text-primary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.message}>{r.message}</td>
                  <td style={{ padding: '3px 8px', color: 'var(--text-secondary)', fontFamily: 'Arial, sans-serif', fontSize: 10 }}>{r.source ?? '—'}</td>
                  <td style={{ padding: '3px 8px', color: 'var(--text-muted)', fontFamily: 'Arial, sans-serif', fontSize: 10 }}>{r.trace_id ? r.trace_id.slice(0, 12) + '…' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '3px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
        {filtered.length} of {rows.length} entries
      </div>
    </div>
  );
}

function LocalLogTab() {
  const electronApi = (window as unknown as Record<string, unknown>).electron as { getAppLogs?: (lines?: number) => Promise<string[]> } | undefined;
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!electronApi?.getAppLogs) return;
    setLoading(true);
    try {
      const result = await electronApi.getAppLogs(200);
      setLines(Array.isArray(result) ? result : []);
      setTimeout(() => {
        if (taRef.current) taRef.current.scrollTop = taRef.current.scrollHeight;
      }, 50);
    } catch {
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [electronApi]);

  useEffect(() => { load(); }, [load]);

  const copyAll = useCallback(() => {
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setStatus('Copied!');
      setTimeout(() => setStatus(''), 1400);
    }).catch(() => {});
  }, [lines]);

  if (!electronApi?.getAppLogs) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Only available in the Rocky Mountain Protective Group desktop app.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, alignItems: 'center' }}>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)' }}>
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={copyAll} disabled={lines.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '3px 8px', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 2, cursor: 'pointer', color: 'var(--text-secondary)', opacity: lines.length === 0 ? 0.4 : 1 }}>
          <Copy size={10} /> Copy all
        </button>
        {status && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>{status}</span>}
        <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>{lines.length} lines</span>
      </div>
      <textarea
        ref={taRef}
        readOnly
        value={lines.join('\n')}
        style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'var(--surface-sunken)', color: 'var(--text-primary)', fontSize: 10, fontFamily: 'Arial, sans-serif', lineHeight: 1.5, padding: 10, caretColor: 'transparent' }}
      />
    </div>
  );
}

export default function DesktopEventViewer({ onClose }: DesktopEventViewerProps) {
  const [pos, setPos] = useState({ x: Math.max(0, (window.innerWidth - W) / 2), y: Math.max(0, (window.innerHeight - H) / 4) });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [tab, setTab] = useState<'api' | 'local'>('api');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: W, height: H,
      background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
      borderRadius: 2, boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)', zIndex: 20100,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Title bar */}
      <div onPointerDown={onPointerDown} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, background: 'var(--surface-sunken)', cursor: 'move', flexShrink: 0 }}>
        <AlertCircle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>Event Viewer</span>
        <button aria-label="Close Event Viewer" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {(['api', 'local'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{
            flex: 1, padding: '6px 0', fontSize: 10, fontWeight: tab === t ? 700 : 400,
            color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
            background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid var(--brand-400)' : '2px solid transparent',
            cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {t === 'api' ? 'API Errors' : 'Local Log'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'api' ? <ApiErrorsTab isAdmin={isAdmin} /> : <LocalLogTab />}
      </div>
    </div>
  );
}
