import { useState, useEffect, useCallback } from 'react';
import { Shield, Lock, AlertTriangle, Globe, Users, Key, Loader2, RefreshCw, XCircle, CheckCircle, Monitor, Activity } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/dateUtils';

interface SecurityStatus {
  twoFactorEnabled: boolean; passwordAge: number; trustedDevices: number;
  activeSessions: number; lastLogin: string; lastLoginIp: string;
  passwordExpiresIn?: number; accountStatus?: string;
}

interface LoginEntry {
  id: number; user_id: number; ip_address: string; user_agent: string;
  success: number; reason?: string; created_at: string; full_name?: string;
}

interface ThreatEntry {
  type: string; severity: string; description: string; ip_address?: string;
  timestamp: string; count?: number;
}

export default function SecurityDashboardPage() {
  const { user } = useAuth();
  const isAdmin = ['admin', 'manager', 'supervisor'].includes((user as any)?.role || '');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginEntry[]>([]);
  const [threats, setThreats] = useState<ThreatEntry[]>([]);
  const [blockedIps, setBlockedIps] = useState<any[]>([]);
  const [passwordCompliance, setPasswordCompliance] = useState<any>(null);
  const [sessionAnalytics, setSessionAnalytics] = useState<any>(null);
  const [eventTimeline, setEventTimeline] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'logins' | 'threats' | 'sessions' | 'timeline'>('overview');

  const safe = async <T,>(url: string): Promise<T | null> => {
    try { return await apiFetch<T>(url); } catch { return null; }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, lh, t, bi, pc, sa, et] = await Promise.all([
        safe<SecurityStatus>('/auth/security/status'),
        safe<{ data: LoginEntry[] }>('/auth/security/login-history?limit=50'),
        isAdmin ? safe<{ data: ThreatEntry[] }>('/auth/security/recent-threats') : null,
        isAdmin ? safe<{ data: any[] }>('/auth/security/blocked-ips') : null,
        isAdmin ? safe<any>('/auth/security/password-compliance') : null,
        isAdmin ? safe<any>('/auth/security/session-analytics') : null,
        isAdmin ? safe<{ data: any[] }>('/auth/security/event-timeline?limit=100') : null,
      ]);
      if (s) setStatus(s);
      if (lh) setLoginHistory(lh.data || []);
      if (t) setThreats(t.data || []);
      if (bi) setBlockedIps(bi.data || []);
      if (pc) setPasswordCompliance(pc);
      if (sa) setSessionAnalytics(sa);
      if (et) setEventTimeline(et.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load security data');
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUnblockIp = async (ip: string) => {
    try {
      await apiFetch('/auth/security/unblock-ip', { method: 'POST', body: JSON.stringify({ ip }) });
      setBlockedIps(prev => prev.filter(b => b.ip !== ip));
    } catch (err: any) { setError(err?.message || 'Failed to unblock IP'); }
  };

  if (loading) return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="SECURITY DASHBOARD" icon={Shield} />
      <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-rmpg-400" /></div>
    </div>
  );

  const TABS = [
    { id: 'overview' as const, label: 'Overview', icon: Shield },
    { id: 'logins' as const, label: 'Login History', icon: Key },
    { id: 'threats' as const, label: 'Threats', icon: AlertTriangle, adminOnly: true },
    { id: 'sessions' as const, label: 'Sessions', icon: Monitor, adminOnly: true },
    { id: 'timeline' as const, label: 'Event Timeline', icon: Activity, adminOnly: true },
  ].filter(t => !t.adminOnly || isAdmin);

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="SECURITY DASHBOARD" icon={Shield}>
        <button type="button" className="toolbar-btn text-[9px]" onClick={fetchAll} style={{ padding: '2px 8px' }}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </PanelTitleBar>

      {error && <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{error}</div>}

      {/* Status Cards */}
      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: '2FA', value: status.twoFactorEnabled ? 'ON' : 'OFF', color: status.twoFactorEnabled ? '#22c55e' : '#ef4444', icon: Lock },
            { label: 'Password Age', value: `${status.passwordAge}d`, color: status.passwordAge > 90 ? '#ef4444' : status.passwordAge > 60 ? '#f59e0b' : '#22c55e', icon: Key },
            { label: 'Trusted Devices', value: String(status.trustedDevices), color: '#888888', icon: Monitor },
            { label: 'Active Sessions', value: String(status.activeSessions), color: '#d4a017', icon: Users },
            { label: 'Last Login IP', value: (status.lastLoginIp || '—').slice(0, 15), color: '#888888', icon: Globe },
            { label: 'Account', value: status.accountStatus || 'Active', color: '#22c55e', icon: CheckCircle },
          ].map(c => (
            <div key={c.label} className="panel-beveled bg-surface-base p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <c.icon className="w-3 h-3" style={{ color: c.color }} />
                <span className="text-[8px] text-rmpg-500 uppercase font-bold">{c.label}</span>
              </div>
              <div className="text-sm font-bold font-mono" style={{ color: c.color }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-rmpg-700 pb-1">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === t.id ? 'text-[#d4a017] bg-[#d4a017]/10 border border-[#d4a017]/30' : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/40 border border-transparent'}`}>
            <t.icon className="w-3 h-3 inline mr-1" />{t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Recent Login History */}
          <div className="panel-beveled bg-surface-base p-3">
            <div className="text-[9px] text-[#d4a017] uppercase font-bold mb-2">Recent Logins</div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {loginHistory.slice(0, 10).map(l => (
                <div key={l.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                  {l.success ? <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" /> : <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                  <span className="text-white flex-1 truncate">{l.full_name || `User #${l.user_id}`}</span>
                  <span className="text-rmpg-500 font-mono">{l.ip_address}</span>
                  <span className="text-rmpg-500">{formatDateTime(l.created_at)}</span>
                </div>
              ))}
              {loginHistory.length === 0 && <div className="text-[10px] text-rmpg-500">No login history</div>}
            </div>
          </div>

          {/* Threats */}
          {isAdmin && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-red-400 uppercase font-bold mb-2">Recent Threats</div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {threats.slice(0, 10).map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" style={{ color: t.severity === 'critical' ? '#ef4444' : t.severity === 'high' ? '#f59e0b' : '#888' }} />
                    <span className="text-white flex-1 truncate">{t.description}</span>
                    {t.ip_address && <span className="text-rmpg-500 font-mono">{t.ip_address}</span>}
                  </div>
                ))}
                {threats.length === 0 && <div className="text-[10px] text-rmpg-500">No recent threats detected</div>}
              </div>
            </div>
          )}

          {/* Blocked IPs */}
          {isAdmin && blockedIps.length > 0 && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-red-400 uppercase font-bold mb-2">Blocked IPs ({blockedIps.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {blockedIps.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                    <span className="text-white font-mono flex-1">{b.ip}</span>
                    <span className="text-rmpg-500">{b.reason || 'Rate limited'}</span>
                    <button type="button" className="text-[9px] text-amber-400 hover:underline" onClick={() => handleUnblockIp(b.ip)}>Unblock</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Password Compliance */}
          {isAdmin && passwordCompliance && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-[#d4a017] uppercase font-bold mb-2">Password Compliance</div>
              <div className="space-y-2">
                {(passwordCompliance.data || passwordCompliance.users || []).slice(0, 8).map((u: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <span className="text-white flex-1">{u.full_name || u.username}</span>
                    <span className={`font-mono ${(u.password_age || 0) > 90 ? 'text-red-400' : 'text-green-400'}`}>{u.password_age || 0}d</span>
                    <span className={u.totp_enabled ? 'text-green-400' : 'text-red-400'}>{u.totp_enabled ? '2FA' : 'No 2FA'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'logins' && (
        <div className="panel-beveled bg-surface-base">
          <table className="w-full">
            <thead><tr className="border-b border-rmpg-700">
              {['Status', 'User', 'IP Address', 'User Agent', 'Time', 'Reason'].map(h => (
                <th key={h} className="text-left text-[9px] text-rmpg-500 uppercase font-semibold px-3 py-[3px]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loginHistory.map(l => (
                <tr key={l.id} className="border-b border-rmpg-800 hover:bg-surface-raised">
                  <td className="px-3 py-[2px]">{l.success ? <CheckCircle className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}</td>
                  <td className="px-3 py-[2px] text-[11px] text-white">{l.full_name || `User #${l.user_id}`}</td>
                  <td className="px-3 py-[2px] text-[11px] text-rmpg-300 font-mono">{l.ip_address}</td>
                  <td className="px-3 py-[2px] text-[10px] text-rmpg-500 max-w-[200px] truncate">{l.user_agent}</td>
                  <td className="px-3 py-[2px] text-[10px] text-rmpg-400">{formatDateTime(l.created_at)}</td>
                  <td className="px-3 py-[2px] text-[10px] text-red-400">{l.reason || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'threats' && isAdmin && (
        <div className="panel-beveled bg-surface-base">
          <table className="w-full">
            <thead><tr className="border-b border-rmpg-700">
              {['Severity', 'Type', 'Description', 'IP', 'Time'].map(h => (
                <th key={h} className="text-left text-[9px] text-rmpg-500 uppercase font-semibold px-3 py-[3px]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {threats.map((t, i) => (
                <tr key={i} className="border-b border-rmpg-800 hover:bg-surface-raised">
                  <td className="px-3 py-[2px]"><span className="text-[9px] font-bold uppercase" style={{ color: t.severity === 'critical' ? '#ef4444' : t.severity === 'high' ? '#f59e0b' : '#888' }}>{t.severity}</span></td>
                  <td className="px-3 py-[2px] text-[11px] text-white capitalize">{(t.type || '').replace(/_/g, ' ')}</td>
                  <td className="px-3 py-[2px] text-[10px] text-rmpg-300">{t.description}</td>
                  <td className="px-3 py-[2px] text-[10px] text-rmpg-400 font-mono">{t.ip_address || '—'}</td>
                  <td className="px-3 py-[2px] text-[10px] text-rmpg-400">{formatDateTime(t.timestamp)}</td>
                </tr>
              ))}
              {threats.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-rmpg-500 text-xs">No threats detected</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'sessions' && isAdmin && sessionAnalytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="panel-beveled bg-surface-base p-3">
            <div className="text-[9px] text-[#d4a017] uppercase font-bold mb-2">Session Analytics</div>
            <div className="space-y-2 text-xs">
              {Object.entries(sessionAnalytics.data || sessionAnalytics || {}).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-rmpg-400 capitalize">{k.replace(/_/g, ' ')}</span>
                  <span className="text-white font-mono">{typeof v === 'number' ? v : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'timeline' && isAdmin && (
        <div className="panel-beveled bg-surface-base p-3">
          <div className="text-[9px] text-[#d4a017] uppercase font-bold mb-2">Security Event Timeline</div>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto">
            {eventTimeline.map((e, i) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b border-rmpg-800 text-[10px]">
                <span className="text-rmpg-500 font-mono w-32 flex-shrink-0">{formatDateTime(e.timestamp || e.created_at)}</span>
                <div className="w-2 h-2 mt-1 flex-shrink-0" style={{
                  background: e.severity === 'critical' ? '#ef4444' : e.severity === 'high' ? '#f59e0b' : e.severity === 'medium' ? '#888888' : '#666',
                  borderRadius: '1px',
                }} />
                <span className="text-white flex-1">{e.description || e.action || e.type}</span>
                {e.ip_address && <span className="text-rmpg-500 font-mono">{e.ip_address}</span>}
              </div>
            ))}
            {eventTimeline.length === 0 && <div className="text-rmpg-500 text-xs text-center py-6">No security events</div>}
          </div>
        </div>
      )}
    </div>
  );
}
