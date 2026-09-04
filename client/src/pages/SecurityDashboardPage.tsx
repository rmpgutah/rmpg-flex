import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import {
  Shield, Lock, AlertTriangle, Globe, Users, Key, Loader2,
  RefreshCw, XCircle, CheckCircle, Monitor, Activity,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/dateUtils';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { loginHistoryToCsv, downloadTextFile } from '../utils/rmsListExport';

interface SecurityStatus {
  twoFactorEnabled: boolean; passwordAge: number; trustedDevices: number;
  activeSessions: number; lastLogin: string; lastLoginIp: string;
  passwordExpiresIn?: number; accountStatus?: string;
}

interface LoginEntry {
  id: number; user_id: number; ip_address: string; user_agent: string;
  success: number; reason?: string; created_at: string; full_name?: string;
  device_type?: string | null; browser?: string | null; os?: string | null;
  country?: string | null; region?: string | null; city?: string | null; isp?: string | null;
  likely_vpn_or_hosting?: number | null;
}

interface ThreatEntry {
  type: string; severity: string; description: string; ip_address?: string;
  timestamp: string; count?: number;
  device_type?: string | null; browser?: string | null; os?: string | null;
  country?: string | null; city?: string | null; isp?: string | null;
  prev_country?: string | null; prev_city?: string | null; minutes_between?: number;
  likely_vpn_or_hosting?: number | null;
}

function deviceLabel(e: { browser?: string | null; os?: string | null }): string {
  if (!e.browser && !e.os) return '';
  return `${e.browser ?? '?'} / ${e.os ?? '?'}`;
}

function VpnBadge({ flagged }: { flagged?: number | null }) {
  if (!flagged) return null;
  return (
    <span className="text-[8px] font-bold uppercase text-amber-400 border border-amber-700/50 bg-amber-900/20 px-1 py-0.5" title="Connecting IP's network organization looks like a VPN or hosting/datacenter provider — heuristic, not certain">
      VPN?
    </span>
  );
}

function locationLabel(e: { city?: string | null; region?: string | null; country?: string | null }): string {
  return [e.city, e.region, e.country].filter(Boolean).join(', ');
}

interface LockedAccount {
  id: number; username: string; full_name?: string;
  failed_login_count: number; locked_until: string;
}

type TabId = 'overview' | 'logins' | 'threats' | 'sessions' | 'timeline';

const VALID_TABS: TabId[] = ['overview', 'logins', 'threats', 'sessions', 'timeline'];

export default function SecurityDashboardPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = ['admin', 'manager', 'supervisor'].includes((user as any)?.role || '');

  // Deep-link: ?tab= strips after mount
  const initialTab = ((): TabId => {
    const t = searchParams.get('tab') as TabId | null;
    return t && VALID_TABS.includes(t) ? t : 'overview';
  })();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginEntry[]>([]);
  const [threats, setThreats] = useState<ThreatEntry[]>([]);
  const [blockedIps, setBlockedIps] = useState<any[]>([]);
  const [lockedAccounts, setLockedAccounts] = useState<LockedAccount[]>([]);
  const [passwordCompliance, setPasswordCompliance] = useState<any>(null);
  const [sessionAnalytics, setSessionAnalytics] = useState<any>(null);
  const [eventTimeline, setEventTimeline] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // ConfirmDialog state for unblock-IP (admin-only destructive action)
  const [unblockTarget, setUnblockTarget] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const ipRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Strip deep-link param after first mount
  useEffect(() => {
    if (searchParams.has('tab')) {
      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeGet = async <T,>(url: string): Promise<T | null> => {
    try { return await apiFetch<T>(url); } catch { return null; }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, lh, t, bi, la, pc, sa, et] = await Promise.all([
        safeGet<SecurityStatus>('/auth/security/status'),
        safeGet<{ data: LoginEntry[] }>('/auth/security/login-history?limit=50'),
        isAdmin ? safeGet<{ data: ThreatEntry[] }>('/auth/security/recent-threats') : null,
        isAdmin ? safeGet<{ data: any[] }>('/auth/security/blocked-ips') : null,
        isAdmin ? safeGet<{ data: LockedAccount[] }>('/auth/security/locked-accounts') : null,
        isAdmin ? safeGet<any>('/auth/security/password-compliance') : null,
        isAdmin ? safeGet<any>('/auth/security/session-analytics') : null,
        isAdmin ? safeGet<{ data: any[] }>('/auth/security/event-timeline?limit=100') : null,
      ]);
      if (s) setStatus(s);
      if (lh) setLoginHistory(lh.data || []);
      // API returns raw rows shaped per threat type — no description/severity/
      // ip_address fields exist server-side, so build them here rather than
      // rendering blank text for every threat entry.
      if (t) setThreats((t.data || []).map((raw: any) => {
        let description = raw.description as string | undefined;
        let severity = raw.severity as string | undefined;
        if (!description) {
          if (raw.type === 'impossible_travel') {
            description = `${raw.username} logged in from ${locationLabel(raw)} only ${raw.minutes_between}min after a login from ${locationLabel({ city: raw.prev_city, country: raw.prev_country })}`;
            severity = severity || 'critical';
          } else if (raw.type === 'new_country_login') {
            description = `${raw.username} logged in from a country (${raw.country}) not seen on this account before`;
            severity = severity || 'medium';
          } else {
            description = [raw.username, toDisplayLabel(raw.reason || '')].filter(Boolean).join(' — ');
            severity = severity || (raw.reason === 'user_not_found' ? 'high' : 'medium');
          }
        }
        return { ...raw, description, severity, ip_address: raw.ip_address || raw.ip };
      }));
      if (bi) setBlockedIps(bi.data || []);
      if (la) setLockedAccounts(la.data || []);
      if (pc) setPasswordCompliance(pc);
      if (sa) setSessionAnalytics(sa);
      if (et) setEventTimeline(et.data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load security data');
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // N shortcut — refresh; Esc cascade — close confirm dialog
  const fetchAllRef = useRef(fetchAll);
  fetchAllRef.current = fetchAll;
  const unblockTargetRef = useRef(unblockTarget);
  unblockTargetRef.current = unblockTarget;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'N' || e.key === 'n') {
        e.preventDefault();
        fetchAllRef.current();
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (unblockTargetRef.current) {
          setUnblockTarget(null);
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  const confirmUnblock = async () => {
    if (!unblockTarget) return;
    setUnblocking(true);
    try {
      await apiFetch('/auth/security/unblock-ip', { method: 'POST', body: JSON.stringify({ ip: unblockTarget }) });
      setBlockedIps(prev => prev.filter(b => b.ip !== unblockTarget));
      setUnblockTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to unblock IP');
    } finally {
      setUnblocking(false);
    }
  };

  const confirmUnlock = async () => {
    if (!unlockTarget) return;
    setUnlocking(true);
    try {
      await apiFetch('/auth/security/unlock-account', { method: 'POST', body: JSON.stringify({ username: unlockTarget }) });
      setLockedAccounts(prev => prev.filter(a => a.username !== unlockTarget));
      setUnlockTarget(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to unlock account');
    } finally {
      setUnlocking(false);
    }
  };

  // ── Render: loading state ─────────────────────────────────────────────
  if (loading) return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="SECURITY DASHBOARD" icon={Shield} />
      <div className="flex flex-col items-center gap-2 py-16">
        <Loader2 className="w-6 h-6 animate-spin text-rmpg-400" />
        <span className="text-[10px] text-rmpg-500">Loading security data…</span>
      </div>
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
        <button
          type="button"
          className="toolbar-btn text-[9px]"
          disabled={loginHistory.length === 0}
          onClick={() => downloadTextFile('login-history.csv', loginHistoryToCsv(loginHistory))}
          title="CSV of time, success, IP — no account names"
        >CSV</button>
        <button type="button" className="toolbar-btn text-[9px]" onClick={fetchAll} style={{ padding: '2px 8px' }}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </PanelTitleBar>

      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => void fetchAll()}>Retry</button>
        </div>
      )}

      {/* Status Cards */}
      {!status ? (
        <div className="text-center py-8 text-rmpg-500 text-xs">No security status available</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: '2FA', value: status.twoFactorEnabled ? 'ON' : 'OFF', cls: status.twoFactorEnabled ? 'text-green-400' : 'text-red-400', icon: Lock },
            { label: 'Password Age', value: `${status.passwordAge}d`, cls: status.passwordAge > 90 ? 'text-red-400' : status.passwordAge > 60 ? 'text-amber-400' : 'text-green-400', icon: Key },
            { label: 'Trusted Devices', value: String(status.trustedDevices), cls: 'text-rmpg-400', icon: Monitor },
            { label: 'Active Sessions', value: String(status.activeSessions), cls: 'text-rmpg-100', icon: Users },
            { label: 'Last Login IP', value: (status.lastLoginIp || '—').slice(0, 15), cls: 'text-rmpg-400', icon: Globe },
            { label: 'Account', value: status.accountStatus || 'Active', cls: 'text-green-400', icon: CheckCircle },
          ].map(c => (
            <div key={c.label} className="panel-beveled bg-surface-base p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <c.icon className={`w-3 h-3 ${c.cls}`} />
                <span className="text-[8px] text-rmpg-500 uppercase font-bold">{c.label}</span>
              </div>
              <div className={`text-sm font-bold font-mono ${c.cls}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-rmpg-700 pb-1">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setActiveTab(t.id)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${activeTab === t.id ? 'text-accent-silver-300 bg-accent-silver-300/10 border border-accent-silver-300/30' : 'text-rmpg-400 hover:text-rmpg-100 hover:bg-rmpg-700/40 border border-transparent'}`}>
            <t.icon className="w-3 h-3 inline mr-1" />{t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Recent Login History */}
          <div className="panel-beveled bg-surface-base p-3">
            <div className="text-[9px] text-brand-gold-500 uppercase font-bold mb-2">Recent Logins</div>
            {loginHistory.length === 0 ? (
              <div className="text-[10px] text-rmpg-500 text-center py-4">No login history recorded</div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {loginHistory.slice(0, 10).map(l => (
                  <div key={l.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                    {l.success ? <CheckCircle className="w-3 h-3 text-green-400 flex-shrink-0" /> : <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                    <span className="text-rmpg-100 min-w-0 flex-1 truncate">{l.full_name || `User #${l.user_id}`}</span>
                    <span className="text-rmpg-500 font-mono">{l.ip_address}</span>
                    <span className="text-rmpg-500">{formatDateTime(l.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Threats — admin only */}
          {isAdmin && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-red-400 uppercase font-bold mb-2">Recent Threats</div>
              {threats.length === 0 ? (
                <div className="text-[10px] text-rmpg-500 text-center py-4">No recent threats detected</div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {threats.slice(0, 10).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                      <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${t.severity === 'critical' ? 'text-red-400' : t.severity === 'high' ? 'text-amber-400' : 'text-rmpg-400'}`} />
                      <span className="text-rmpg-100 flex-1 min-w-0 truncate">{t.description}</span>
                      {t.ip_address && <span className="text-rmpg-500 font-mono">{t.ip_address}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Blocked IPs — admin only, hidden when list is empty. Was
              rendering this whole list TWICE (an unconditional map followed
              by a `length === 0 ? empty : map` whose false-branch also
              rendered every row) — merged into one block. */}
          {isAdmin && blockedIps.length > 0 && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-red-400 uppercase font-bold mb-2">Blocked IPs ({blockedIps.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {blockedIps.map((b, i) => (
                  <div
                    key={i}
                    ref={el => { ipRowRefs.current[b.ip] = el; }}
                    className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800 transition-all flex-wrap"
                  >
                    <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                    <span className="text-rmpg-100 font-mono flex-1">{b.ip}</span>
                    {locationLabel(b) && <span className="text-fg-muted">{locationLabel(b)}</span>}
                    {b.isp && <span className="text-fg-muted">{b.isp}</span>}
                    {b.usernames_tried && <span className="text-amber-400" title="Distinct usernames attempted from this IP in the last 24h">{String(b.usernames_tried).split(',').length} accounts tried</span>}
                    <span className="text-fg-muted">{b.reason || `${b.failed_attempts} failed attempts`}</span>
                    <button
                      type="button"
                      className="text-[9px] text-amber-400 hover:underline"
                      onClick={() => setUnblockTarget(b.ip)}
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Locked Accounts — admin only, hidden when list is empty */}
          {isAdmin && lockedAccounts.length > 0 && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-red-400 uppercase font-bold mb-2">Locked Accounts ({lockedAccounts.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {lockedAccounts.map(a => (
                  <div key={a.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800">
                    <Lock className="w-3 h-3 text-red-400 flex-shrink-0" />
                    <span className="text-rmpg-100 flex-1 truncate">{a.full_name || a.username}</span>
                    <span className="text-rmpg-500">{a.failed_login_count} failed attempts</span>
                    <button
                      type="button"
                      className="text-[9px] text-amber-400 hover:underline"
                      onClick={() => setUnlockTarget(a.username)}
                    >
                      Unlock
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Password Compliance — admin only */}
          {isAdmin && passwordCompliance && (
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-brand-gold-500 uppercase font-bold mb-2">Password Compliance</div>
              {(passwordCompliance.data || passwordCompliance.users || []).length === 0 ? (
                <div className="text-[10px] text-rmpg-500 text-center py-4">No compliance data</div>
              ) : (
                <div className="space-y-2">
                  {(passwordCompliance.data || passwordCompliance.users || []).slice(0, 8).map((u: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className="text-rmpg-100 flex-1">{u.full_name || u.username}</span>
                      <span className={`font-mono ${(u.password_age || 0) > 90 ? 'text-red-400' : 'text-green-400'}`}>{u.password_age || 0}d</span>
                      <span className={u.totp_enabled ? 'text-green-400' : 'text-red-400'}>{u.totp_enabled ? '2FA' : 'No 2FA'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'logins' && (
        loginHistory.length === 0 ? (
          <div className="panel-beveled bg-surface-base text-center py-8 text-rmpg-500 text-xs">No login history recorded</div>
        ) : (
          <div className="panel-beveled bg-surface-base overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead><tr className="border-b border-rmpg-700">
                {['Status', 'User', 'IP Address', 'Device', 'Location', 'ISP', 'Time', 'Reason'].map(h => (
                  <th key={h} className="text-left text-[9px] text-rmpg-500 uppercase font-semibold px-3 py-[3px]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {loginHistory.map(l => (
                  <tr key={l.id} className="border-b border-rmpg-800 hover:bg-surface-raised">
                    <td className="px-3 py-[2px]">{l.success ? <CheckCircle className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}</td>
                    <td className="px-3 py-[2px] text-[11px] text-rmpg-100">{l.full_name || `User #${l.user_id}`}</td>
                    <td className="px-3 py-[2px] text-[11px] text-rmpg-300 font-mono">{l.ip_address}</td>
                    <td className="px-3 py-[2px] text-[10px] text-fg-muted">{deviceLabel(l) || '—'}</td>
                    <td className="px-3 py-[2px] text-[10px] text-fg-muted">{locationLabel(l) || '—'}</td>
                    <td className="px-3 py-[2px] text-[10px] text-fg-muted max-w-[160px] truncate">{l.isp || '—'} <VpnBadge flagged={l.likely_vpn_or_hosting} /></td>
                    <td className="px-3 py-[2px] text-[10px] text-rmpg-400">{formatDateTime(l.created_at)}</td>
                    <td className="px-3 py-[2px] text-[10px] text-red-400">{l.reason || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {activeTab === 'threats' && isAdmin && (
        threats.length === 0 ? (
          <div className="panel-beveled bg-surface-base text-center py-8 text-rmpg-500 text-xs">No threats detected</div>
        ) : (
          <div className="panel-beveled bg-surface-base overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead><tr className="border-b border-rmpg-700">
                {['Severity', 'Type', 'Description', 'Device', 'IP', 'Time'].map(h => (
                  <th key={h} className="text-left text-[9px] text-rmpg-500 uppercase font-semibold px-3 py-[3px]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {threats.map((t, i) => (
                  <tr key={i} className="border-b border-rmpg-800 hover:bg-surface-raised">
                    <td className="px-3 py-[2px]"><span className={`text-[9px] font-bold uppercase ${t.severity === 'critical' ? 'text-red-400' : t.severity === 'high' ? 'text-amber-400' : 'text-rmpg-400'}`}>{formatEnumValue(t.severity)}</span></td>
                    <td className="px-3 py-[2px] text-[11px] text-rmpg-100 capitalize">{toDisplayLabel(t.type || '')}</td>
                    <td className="px-3 py-[2px] text-[10px] text-rmpg-300">{t.description}</td>
                    <td className="px-3 py-[2px] text-[10px] text-fg-muted">{deviceLabel(t) || '—'}</td>
                    <td className="px-3 py-[2px] text-[10px] text-rmpg-400 font-mono">{t.ip_address || '—'} <VpnBadge flagged={t.likely_vpn_or_hosting} /></td>
                    <td className="px-3 py-[2px] text-[10px] text-rmpg-400">{formatDateTime(t.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {activeTab === 'sessions' && isAdmin && (
        !sessionAnalytics ? (
          <div className="panel-beveled bg-surface-base text-center py-8 text-rmpg-500 text-xs">No session analytics available</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="panel-beveled bg-surface-base p-3">
              <div className="text-[9px] text-brand-gold-500 uppercase font-bold mb-2">Session Analytics</div>
              <div className="space-y-2 text-xs">
                {Object.entries(sessionAnalytics.data || sessionAnalytics || {}).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-rmpg-400 capitalize">{toDisplayLabel(k)}</span>
                    <span className="text-rmpg-100 font-mono">{typeof v === 'number' ? v : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {activeTab === 'timeline' && isAdmin && (
        <div className="panel-beveled bg-surface-base p-3">
          <div className="text-[9px] text-brand-gold-500 uppercase font-bold mb-2">Security Event Timeline</div>
          {eventTimeline.length === 0 ? (
            <div className="text-rmpg-500 text-xs text-center py-6">No security events recorded</div>
          ) : (
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {eventTimeline.map((e, i) => (
                <div key={i} className="flex items-start gap-3 py-1.5 border-b border-rmpg-800 text-[10px] flex-wrap">
                  <span className="text-rmpg-500 font-mono w-32 flex-shrink-0">{formatDateTime(e.timestamp || e.created_at)}</span>
                  <div className={`w-2 h-2 mt-1 flex-shrink-0 ${
                    e.event === 'failed_login' ? 'bg-red-400' :
                    e.severity === 'critical' ? 'bg-red-400' :
                    e.severity === 'high' ? 'bg-amber-400' :
                    e.severity === 'medium' ? 'bg-rmpg-400' : 'bg-green-400'
                  }`} style={{ borderRadius: '1px' }} />
                  <span className="text-rmpg-100 flex-1 min-w-[140px]">
                    {e.description || e.action || (e.event ? `${toDisplayLabel(e.event)}${e.username ? ` — ${e.username}` : ''}${e.reason ? ` (${toDisplayLabel(e.reason)})` : ''}` : e.type)}
                  </span>
                  {deviceLabel(e) && <span className="text-fg-muted">{deviceLabel(e)}</span>}
                  {locationLabel(e) && <span className="text-fg-muted">{locationLabel(e)}</span>}
                  {(e.ip_address || e.ip) && <span className="text-fg-muted font-mono">{e.ip_address || e.ip}</span>}
                  <VpnBadge flagged={e.likely_vpn_or_hosting} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ConfirmDialog for unblock-IP (admin-only destructive action) */}
      <ConfirmDialog
        isOpen={!!unblockTarget}
        onClose={() => setUnblockTarget(null)}
        onConfirm={confirmUnblock}
        title="Unblock IP Address"
        message="Are you sure you want to remove this IP from the block list? It will immediately be able to attempt logins again."
        details={unblockTarget ? <span className="font-mono text-rmpg-100">{unblockTarget}</span> : undefined}
        confirmLabel="Unblock"
        confirmVariant="warning"
        isLoading={unblocking}
      />

      <ConfirmDialog
        isOpen={!!unlockTarget}
        onClose={() => setUnlockTarget(null)}
        onConfirm={confirmUnlock}
        title="Unlock Account"
        message="Are you sure you want to unlock this account? The user will be able to attempt logins again immediately."
        details={unlockTarget ? <span className="font-mono text-rmpg-100">{unlockTarget}</span> : undefined}
        confirmLabel="Unlock"
        confirmVariant="warning"
        isLoading={unlocking}
      />
    </div>
  );
}
