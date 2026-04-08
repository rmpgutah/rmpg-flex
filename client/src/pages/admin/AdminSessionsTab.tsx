// ============================================================
// RMPG Flex — Admin Sessions Tab
// Active session management: view and revoke user sessions.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Trash2, Monitor, Smartphone, Globe, RefreshCw, History } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { toDisplayLabel } from '../../utils/formatters';
import LoginHistoryTable from '../../components/security/LoginHistoryTable';
import { useToast } from '../../components/ToastProvider';
import { safeDateTimeStr } from '../../utils/dateUtils';

interface Session {
  id: number;
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  ip_address: string;
  user_agent: string;
  is_active: number;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

function parseUserAgent(ua: string): { device: string; icon: React.ElementType } {
  if (!ua) return { device: 'Unknown', icon: Globe };
  if (/Mobile|Android|iPhone/i.test(ua)) return { device: 'Mobile', icon: Smartphone };
  return { device: 'Desktop', icon: Monitor };
}

function isExpired(expiresAt: string) {
  return new Date(expiresAt) < new Date();
}

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function AdminSessionsTab({ LoadingSpinner, error, setError }: Props) {
  const { addToast } = useToast();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await apiFetch<Session[]>('/admin/sessions');
      setSessions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);
  useLiveSync('admin', fetchSessions);

  const handleRevoke = async (sessionId: number) => {
    if (!confirm('Revoke this session? The user will be logged out.')) return;
    try {
      await apiFetch(`/admin/sessions/${sessionId}`, { method: 'DELETE' });
      fetchSessions();
      addToast('Session revoked', 'success');
    } catch (err: any) {
      addToast(err.message || 'Failed to revoke session', 'error');
    }
  };

  if (loading) return <LoadingSpinner />;

  const activeSessions = sessions.filter(s => s.is_active && !isExpired(s.expires_at));
  const inactiveSessions = sessions.filter(s => !s.is_active || isExpired(s.expires_at));

  return (
    <div className="p-4 space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="group" aria-label="Session statistics">
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-green-900/30 border border-green-700/40 shrink-0" aria-hidden="true">
            <Shield style={{ width: 14, height: 14 }} className="text-green-400" />
          </div>
          <div>
            <div className="text-[18px] font-black text-green-400 tabular-nums leading-tight">{activeSessions.length}</div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Active Sessions</div>
          </div>
        </div>
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-rmpg-800/50 border border-rmpg-600/40 shrink-0" aria-hidden="true">
            <Globe style={{ width: 14, height: 14 }} className="text-rmpg-400" />
          </div>
          <div>
            <div className="text-[18px] font-black text-rmpg-400 tabular-nums leading-tight">{inactiveSessions.length}</div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Inactive / Expired</div>
          </div>
        </div>
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-blue-900/30 border border-blue-700/40 shrink-0" aria-hidden="true">
            <Monitor style={{ width: 14, height: 14 }} className="text-blue-400" />
          </div>
          <div>
            <div className="text-[18px] font-black text-blue-400 tabular-nums leading-tight">
              {new Set(activeSessions.map(s => s.user_id)).size}
            </div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Unique Users Online</div>
          </div>
        </div>
      </div>

      {/* Active Sessions Table */}
      <div className="flex items-center gap-2 mb-2 border-b border-[#242a32] pb-1.5">
        <Shield style={{ width: 11, height: 11 }} className="text-green-400" aria-hidden="true" />
        <span className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Active Sessions ({activeSessions.length})</span>
        <button type="button" onClick={fetchSessions} className="ml-auto p-1 text-rmpg-500 hover:text-white hover:bg-surface-raised/50 transition-colors" aria-label="Refresh sessions">
          <RefreshCw style={{ width: 11, height: 11 }} />
        </button>
      </div>
      <table className="w-full text-[10px] mb-6" aria-label="Active sessions">
        <thead>
          <tr className="text-rmpg-500 text-[9px] uppercase tracking-wider sticky top-0 z-10 border-b border-[#242a32]" style={{ background: '#050505' }}>
            <th className="text-left px-3 py-2.5 font-bold whitespace-nowrap" scope="col">User</th>
            <th className="text-left px-3 py-2.5 font-bold whitespace-nowrap" scope="col">Role</th>
            <th className="text-left px-3 py-2.5 font-bold whitespace-nowrap" scope="col">Device</th>
            <th className="text-left px-3 py-2.5 font-bold whitespace-nowrap" scope="col">IP Address</th>
            <th className="text-left px-3 py-2.5 font-bold whitespace-nowrap" scope="col">Last Active</th>
            <th className="text-left px-3 py-2.5 font-bold whitespace-nowrap" scope="col">Expires</th>
            <th className="text-right px-3 py-2.5 font-bold whitespace-nowrap" scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {activeSessions.map((s, idx) => {
            const { device, icon: DeviceIcon } = parseUserAgent(s.user_agent);
            return (
              <tr key={s.id} className={`border-b border-rmpg-800/30 hover:bg-surface-raised/30 transition-colors ${idx % 2 !== 0 ? 'bg-rmpg-800/10' : ''}`}>
                <td className="px-3 py-2">
                  <span className="font-semibold text-white">{s.full_name}</span>
                  <span className="text-rmpg-500 ml-1">({s.username})</span>
                </td>
                <td className="px-3 py-2 text-rmpg-400">{toDisplayLabel(s.role)}</td>
                <td className="px-3 py-2 text-rmpg-400">
                  <span className="flex items-center gap-1">
                    <DeviceIcon style={{ width: 10, height: 10 }} aria-hidden="true" />
                    {device}
                  </span>
                </td>
                <td className="px-3 py-2 text-rmpg-400 font-mono tabular-nums">{s.ip_address || '—'}</td>
                <td className="px-3 py-2 text-rmpg-400 tabular-nums">
                  {s.last_used_at ? new Date(s.last_used_at).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-rmpg-400 tabular-nums">
                  {safeDateTimeStr(s.expires_at)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button"
                    onClick={() => handleRevoke(s.id)}
                    className="p-1.5 text-rmpg-500 hover:text-red-400 hover:bg-red-900/25 transition-all duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/50"
                    title="Revoke session"
                    aria-label={`Revoke session for ${s.full_name}`}
                  >
                    <Trash2 style={{ width: 11, height: 11 }} />
                  </button>
                </td>
              </tr>
            );
          })}
          {activeSessions.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-10 text-center text-rmpg-500">
              <div className="flex flex-col items-center gap-2">
                <Shield className="w-6 h-6 text-rmpg-600" aria-hidden="true" />
                <span className="text-[11px] text-rmpg-500">No active sessions</span>
                <span className="text-[9px] text-rmpg-600">All user sessions have expired or been revoked</span>
              </div>
            </td></tr>
          )}
        </tbody>
      </table>

      {/* Login History */}
      <div className="flex items-center gap-2 mb-2 border-b border-[#242a32] pb-1.5">
        <History style={{ width: 11, height: 11 }} className="text-blue-400" aria-hidden="true" />
        <span className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">Recent Login History</span>
      </div>
      <div className="panel-surface mb-4">
        <LoginHistoryTable />
      </div>
    </div>
  );
}
