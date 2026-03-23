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

const timeAgo = (date: string) => {
  const ms = Date.now() - new Date(date).getTime();
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
    <div className="p-4">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="panel-beveled p-3">
          <div className="text-[20px] font-black text-green-400">{activeSessions.length}</div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Active Sessions</div>
        </div>
        <div className="panel-beveled p-3">
          <div className="text-[20px] font-black text-rmpg-400">{inactiveSessions.length}</div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Inactive/Expired</div>
        </div>
        <div className="panel-beveled p-3">
          <div className="text-[20px] font-black text-blue-400">
            {new Set(activeSessions.map(s => s.user_id)).size}
          </div>
          <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Unique Users Online</div>
        </div>
      </div>

      {/* Active Sessions Table */}
      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
        <Shield style={{ width: 10, height: 10 }} />
        Active Sessions ({activeSessions.length})
        <button type="button" onClick={fetchSessions} className="ml-auto text-rmpg-500 hover:text-white">
          <RefreshCw style={{ width: 10, height: 10 }} />
        </button>
      </div>
      <table className="w-full text-[10px] mb-6">
        <thead>
          <tr className="text-rmpg-500 text-[9px] uppercase tracking-wider" style={{ background: '#0f1a28' }}>
            <th className="text-left px-3 py-1.5 font-bold whitespace-nowrap">User</th>
            <th className="text-left px-3 py-1.5 font-bold whitespace-nowrap">Role</th>
            <th className="text-left px-3 py-1.5 font-bold whitespace-nowrap">Device</th>
            <th className="text-left px-3 py-1.5 font-bold whitespace-nowrap">IP Address</th>
            <th className="text-left px-3 py-1.5 font-bold whitespace-nowrap">Last Active</th>
            <th className="text-left px-3 py-1.5 font-bold whitespace-nowrap">Expires</th>
            <th className="text-right px-3 py-1.5 font-bold whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody>
          {activeSessions.map(s => {
            const { device, icon: DeviceIcon } = parseUserAgent(s.user_agent);
            return (
              <tr key={s.id} className="border-b border-rmpg-800/30 hover:bg-surface-raised/30 transition-colors">
                <td className="px-3 py-2">
                  <span className="font-semibold text-white">{s.full_name}</span>
                  <span className="text-rmpg-500 ml-1">({s.username})</span>
                </td>
                <td className="px-3 py-2 text-rmpg-400">{toDisplayLabel(s.role)}</td>
                <td className="px-3 py-2 text-rmpg-400 flex items-center gap-1">
                  <DeviceIcon style={{ width: 10, height: 10 }} />
                  {device}
                </td>
                <td className="px-3 py-2 text-rmpg-400 font-mono">{s.ip_address || '—'}</td>
                <td className="px-3 py-2 text-rmpg-400">
                  {s.last_used_at ? new Date(s.last_used_at).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-rmpg-400">
                  {new Date(s.expires_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button"
                    onClick={() => handleRevoke(s.id)}
                    className="text-rmpg-500 hover:text-red-400 transition-colors"
                    title="Revoke session"
                  >
                    <Trash2 style={{ width: 10, height: 10 }} />
                  </button>
                </td>
              </tr>
            );
          })}
          {activeSessions.length === 0 && (
            <tr><td colSpan={7} className="px-3 py-6 text-center text-rmpg-500">No active sessions</td></tr>
          )}
        </tbody>
      </table>

      {/* Login History */}
      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2 flex items-center gap-2">
        <History style={{ width: 10, height: 10 }} />
        Recent Login History
      </div>
      <div className="panel-surface mb-4">
        <LoginHistoryTable />
      </div>
    </div>
  );
}
