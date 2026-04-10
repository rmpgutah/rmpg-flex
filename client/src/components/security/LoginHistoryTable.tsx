import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, ChevronLeft, ChevronRight, RefreshCw, History } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { LoginHistoryEntry } from '../../types';

function parseDevice(ua: string): string {
  if (!ua) return 'Unknown';
  const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/)?.[0]?.split('/')[0] || '';
  const os = ua.includes('Windows') ? 'Windows'
    : ua.includes('Mac') ? 'macOS'
    : ua.includes('Linux') ? 'Linux'
    : ua.includes('Android') ? 'Android'
    : ua.includes('iPhone') ? 'iOS'
    : '';
  return [browser, os].filter(Boolean).join(' on ') || ua.slice(0, 30);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const PAGE_SIZE = 15;

export default function LoginHistoryTable() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<LoginHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/auth/security/login-history?limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
        setTotal(data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [token, offset]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-4 h-4 animate-spin" style={{ color: '#666666' }} />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-6">
        <History className="w-6 h-6 mx-auto mb-2" style={{ color: '#2e2e2e' }} />
        <p className="text-[10px]" style={{ color: '#666666' }}>No login history</p>
      </div>
    );
  }

  return (
    <div>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="table-dark w-full">
          <thead>
            <tr>
              <th className="w-6"></th>
              <th>Time</th>
              <th>Device</th>
              <th>IP Address</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={entry.id}>
                <td className="text-center">
                  {entry.success ? (
                    <CheckCircle className="w-3 h-3 inline-block" style={{ color: '#22c55e' }} />
                  ) : (
                    <XCircle className="w-3 h-3 inline-block" style={{ color: '#ef4444' }} />
                  )}
                </td>
                <td className="font-mono whitespace-nowrap">{formatDate(entry.created_at)}</td>
                <td className="truncate max-w-[180px]">{parseDevice(entry.user_agent)}</td>
                <td className="font-mono">{entry.ip_address}</td>
                <td>
                  {entry.success ? (
                    <span style={{ color: '#22c55e' }}>Success</span>
                  ) : (
                    <span style={{ color: '#ef4444' }} title={entry.failure_reason || ''}>
                      {entry.failure_reason || 'Failed'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ borderTop: '1px solid #2b2b2b', background: '#050505' }}
        >
          <span className="text-[10px] font-mono" style={{ color: '#666666' }}>
            Page {page} of {totalPages} ({total} entries)
          </span>
          <div className="flex gap-1">
            <button type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="toolbar-btn text-[9px] disabled:opacity-30"
            >
              <ChevronLeft className="w-3 h-3" />
              Prev
            </button>
            <button type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={page >= totalPages}
              className="toolbar-btn text-[9px] disabled:opacity-30"
            >
              Next
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
