import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { safeDateTimeStr } from '../../utils/dateUtils';
import RichTextArea from '../../components/RichTextArea';
import {
  Shield, Database, Users, Bell, Trash2, RefreshCw, Download, HardDrive,
  Activity, UserCheck, AlertTriangle, CheckCircle, Play, Archive, BarChart3,
  Loader2, Eye, Lock, Unlock, Merge, Terminal, Radio, Globe, Clock,
} from 'lucide-react';

const safeStr = (v: any): string => {
  try { return JSON.stringify(v)?.slice(0, 80) ?? ''; } catch { return ''; }
};

interface DbStats {
  database_size_mb: number;
  freelist_mb: number;
  reclaimable_percent: number;
  table_count: number;
  total_rows: number;
  index_count: number;
  journal_mode: string;
  integrity: string;
  tables: { name: string; row_count: number }[];
  server?: any;
}

interface SystemOverview {
  server: {
    uptime: string;
    node_version: string;
    platform: string;
    hostname: string;
    total_memory_gb: number;
    free_memory_gb: number;
    load_average: number[];
    cpus: number;
  };
  active_users_24h: number;
  record_counts: Record<string, number>;
}

interface Backup {
  filename: string;
  size_mb: number;
  created_at: string;
}

export default function AdminGodModeTab() {
  const [loading, setLoading] = useState(false);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [systemOverview, setSystemOverview] = useState<SystemOverview | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Impersonation
  const [impersonateUserId, setImpersonateUserId] = useState('');
  const [users, setUsers] = useState<any[]>([]);

  // Broadcast
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastRoles, setBroadcastRoles] = useState<string[]>([]);

  // Purge
  const [purgeLogDays, setPurgeLogDays] = useState(90);
  const [purgeNotifDays, setPurgeNotifDays] = useState(30);

  // Bulk reassign
  const [reassignCallIds, setReassignCallIds] = useState('');
  const [reassignTargetId, setReassignTargetId] = useState('');

  // Force close
  const [closeDisposition, setCloseDisposition] = useState('Closed by Admin');

  // SQL Console
  const [sqlQuery, setSqlQuery] = useState('');
  const [sqlResult, setSqlResult] = useState<any>(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  // Lockdown
  const [lockdownStatus, setLockdownStatus] = useState<any>(null);
  const [lockdownMessage, setLockdownMessage] = useState('System is in lockdown mode. Only administrators can access the system.');
  const [lockdownKickSessions, setLockdownKickSessions] = useState(false);

  // Merge persons
  const [mergeKeepId, setMergeKeepId] = useState('');
  const [mergeMergeId, setMergeMergeId] = useState('');

  // WebSocket / Presence
  const [wsClients, setWsClients] = useState<any[]>([]);
  const [userPresence, setUserPresence] = useState<any>(null);

  // Activity feed
  const [activityFeed, setActivityFeed] = useState<any[]>([]);

  const showResult = useCallback((type: 'success' | 'error', message: string) => {
    setActionResult({ type, message });
    setTimeout(() => setActionResult(null), 5000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, overview, bk, userList] = await Promise.all([
        apiFetch<DbStats>('/admin/database/stats').catch(() => null),
        apiFetch<SystemOverview>('/admin/system-overview').catch(() => null),
        apiFetch<Backup[]>('/admin/database/backups').catch(() => []),
        apiFetch<any[]>('/admin/users').catch(() => []),
      ]);
      if (stats) setDbStats(stats);
      if (overview) setSystemOverview(overview);
      setBackups(bk || []);
      setUsers(userList || []);

      const [ws, presence, lockdown, feed] = await Promise.all([
        apiFetch<any>('/admin/websocket/clients').catch(() => ({ clients: [] })),
        apiFetch<any>('/admin/users/presence').catch(() => null),
        apiFetch<any>('/admin/system/lockdown').catch(() => null),
        apiFetch<any>('/admin/activity-feed?limit=20').catch(() => ({ actions: [] })),
      ]);
      setWsClients(ws?.clients || []);
      if (presence) setUserPresence(presence);
      if (lockdown) setLockdownStatus(lockdown);
      setActivityFeed(feed?.actions || []);
    } catch (err) {
      console.error('God Mode load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleVacuum = async () => {
    try {
      const result = await apiFetch<any>('/admin/database/vacuum', { method: 'POST' });
      showResult('success', `VACUUM complete — reclaimed ${result.reclaimed_mb}MB (${result.before_size_mb}MB → ${result.after_size_mb}MB)`);
      loadData();
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleIntegrity = async () => {
    try {
      const result = await apiFetch<any>('/admin/database/integrity-check', { method: 'POST' });
      showResult(result.healthy ? 'success' : 'error', result.healthy ? 'Database integrity: OK' : `Issues found: ${result.result.join(', ')}`);
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleBackup = async () => {
    try {
      const result = await apiFetch<any>('/admin/database/backup', { method: 'POST' });
      showResult('success', `Backup created: ${result.backup_path} (${result.size_mb}MB)`);
      loadData();
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleAnalyze = async () => {
    try {
      await apiFetch<any>('/admin/database/analyze', { method: 'POST' });
      showResult('success', 'ANALYZE complete — query optimizer updated');
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleDeleteBackup = async (filename: string) => {
    try {
      await apiFetch<any>(`/admin/database/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      showResult('success', `Deleted backup: ${filename}`);
      loadData();
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleImpersonate = async () => {
    if (!impersonateUserId) return;
    try {
      const result = await apiFetch<any>(`/admin/impersonate/${impersonateUserId}`, { method: 'POST' });
      showResult('success', `Impersonating ${result.user.full_name} (${result.user.role}) — token valid for ${result.expires_in}`);
      // Copy token to clipboard
      navigator.clipboard?.writeText(result.token);
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) return;
    try {
      const result = await apiFetch<any>('/notifications/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          title: broadcastTitle.trim(),
          message: broadcastMessage.trim(),
          target_roles: broadcastRoles.length > 0 ? broadcastRoles : undefined,
        }),
      });
      showResult('success', `Broadcast sent to ${result.sent_to} users`);
      setBroadcastTitle('');
      setBroadcastMessage('');
    } catch (err: any) { showResult('error', err.message); }
  };

  const handlePurgeLogs = async () => {
    try {
      const result = await apiFetch<any>('/admin/purge/activity-logs', {
        method: 'POST',
        body: JSON.stringify({ days_to_keep: purgeLogDays }),
      });
      showResult('success', `Purged ${result.purged} activity log entries older than ${purgeLogDays} days`);
      loadData();
    } catch (err: any) { showResult('error', err.message); }
  };

  const handlePurgeNotifs = async () => {
    try {
      const result = await apiFetch<any>('/admin/purge/notifications', {
        method: 'POST',
        body: JSON.stringify({ days_to_keep: purgeNotifDays }),
      });
      showResult('success', `Purged ${result.purged} read notifications older than ${purgeNotifDays} days`);
    } catch (err: any) { showResult('error', err.message); }
  };

  const handlePurgeSessions = async () => {
    try {
      const result = await apiFetch<any>('/admin/purge/sessions', { method: 'POST' });
      showResult('success', `Purged ${result.purged} expired sessions`);
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleBulkReassign = async () => {
    const ids = reassignCallIds.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (!ids.length || !reassignTargetId) return;
    try {
      const r = await apiFetch<any>('/admin/calls/bulk-reassign', {
        method: 'POST', body: JSON.stringify({ call_ids: ids, target_officer_id: parseInt(reassignTargetId) }),
      });
      showResult('success', `Reassigned ${r.updated} calls to ${r.target}`);
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleForceCloseAll = async () => {
    try {
      const r = await apiFetch<any>('/admin/calls/force-close-all', {
        method: 'POST', body: JSON.stringify({ disposition: closeDisposition }),
      });
      showResult('success', `Force-closed ${r.closed} open calls`);
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleSqlQuery = async () => {
    if (!sqlQuery.trim()) return;
    setSqlRunning(true);
    setSqlResult(null);
    try {
      const r = await apiFetch<any>('/admin/query', {
        method: 'POST', body: JSON.stringify({ sql: sqlQuery }),
      });
      setSqlResult(r);
    } catch (err: any) { setSqlResult({ error: err.message }); }
    finally { setSqlRunning(false); }
  };

  const handleToggleLockdown = async () => {
    try {
      if (lockdownStatus?.active) {
        await apiFetch<any>('/admin/system/lockdown', { method: 'DELETE' });
        showResult('success', 'Lockdown DISABLED');
      } else {
        await apiFetch<any>('/admin/system/lockdown', {
          method: 'POST', body: JSON.stringify({ message: lockdownMessage, kick_sessions: lockdownKickSessions }),
        });
        showResult('success', 'Lockdown ENABLED — non-admin users blocked');
      }
      loadData();
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleMergePersons = async () => {
    if (!mergeKeepId || !mergeMergeId) return;
    try {
      const r = await apiFetch<any>('/admin/records/persons/merge', {
        method: 'POST', body: JSON.stringify({ keep_id: parseInt(mergeKeepId), merge_id: parseInt(mergeMergeId) }),
      });
      showResult('success', `Merged Person #${r.merged} into #${r.kept} — ${r.records_reassigned} records reassigned`);
      setMergeKeepId(''); setMergeMergeId('');
    } catch (err: any) { showResult('error', err.message); }
  };

  const handleFullExport = async () => {
    try {
      const token = localStorage.getItem('rmpg_token');
      const resp = await fetch('/api/admin/export/full', { headers: { Authorization: `Bearer ${token}` } });
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rmpg-flex-export-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showResult('success', 'Full export downloaded');
    } catch (err: any) { showResult('error', err.message); }
  };

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-red-400" />
          <h2 className="text-sm font-bold text-red-400 uppercase tracking-wider">God Mode — Admin Control Panel</h2>
        </div>
        <button onClick={loadData} disabled={loading} className="flex items-center gap-1 px-2 py-1 bg-[#181818] hover:bg-[#313131] border border-[#2a2a2a] rounded-sm text-[11px] text-gray-300">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
        </button>
      </div>

      {/* Action Result Banner */}
      {actionResult && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-sm text-[11px] font-bold ${actionResult.type === 'success' ? 'bg-green-900/40 text-green-300 border border-green-700/40' : 'bg-red-900/40 text-red-300 border border-red-700/40'}`}>
          {actionResult.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          {actionResult.message}
        </div>
      )}

      {/* System Overview */}
      {systemOverview?.server && (
        <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Activity size={14} /> System Overview</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <StatBox label="Uptime" value={systemOverview.server.uptime ?? '—'} />
            <StatBox label="Node" value={systemOverview.server.node_version ?? '?'} />
            <StatBox label="CPUs" value={String(systemOverview.server.cpus ?? '?')} />
            <StatBox label="Memory" value={`${systemOverview.server.free_memory_gb ?? 0}/${systemOverview.server.total_memory_gb ?? 0} GB`} />
            <StatBox label="Load" value={systemOverview.server.load_average?.join(' / ') ?? '—'} />
            <StatBox label="Active Users (24h)" value={String(systemOverview.active_users_24h ?? 0)} />
          </div>
          <div className="mt-2 grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-1">
            {Object.entries(systemOverview.record_counts ?? {}).filter(([, v]) => v >= 0).map(([table, count]) => (
              <div key={table} className="bg-[#0c0c0c] px-2 py-1 rounded-sm">
                <div className="text-[9px] text-gray-500 uppercase truncate">{table.replace(/_/g, ' ')}</div>
                <div className="text-[11px] font-mono text-white">{formatNumber(count)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Database Maintenance */}
      {dbStats && (
        <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Database size={14} /> Database Maintenance</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <StatBox label="DB Size" value={`${dbStats.database_size_mb} MB`} />
            <StatBox label="Reclaimable" value={`${dbStats.freelist_mb} MB (${dbStats.reclaimable_percent}%)`} />
            <StatBox label="Tables / Indexes" value={`${dbStats.table_count} / ${dbStats.index_count}`} />
            <StatBox label="Integrity" value={dbStats.integrity} color={dbStats.integrity === 'OK' ? 'text-green-400' : 'text-red-400'} />
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <ActionButton icon={HardDrive} label="VACUUM" onClick={handleVacuum} color="blue" />
            <ActionButton icon={CheckCircle} label="Integrity Check" onClick={handleIntegrity} color="green" />
            <ActionButton icon={Download} label="Create Backup" onClick={handleBackup} color="blue" />
            <ActionButton icon={BarChart3} label="ANALYZE" onClick={handleAnalyze} color="blue" />
          </div>
          {/* Top tables */}
          <div className="bg-[#0c0c0c] rounded-sm p-2 max-h-40 overflow-y-auto">
            <div className="text-[9px] text-gray-500 uppercase mb-1">Top Tables by Row Count</div>
            {(dbStats.tables || []).slice(0, 15).map(t => (
              <div key={t.name} className="flex justify-between text-[11px] py-0.5 border-b border-[#181818]/50">
                <span className="text-gray-300 font-mono">{t.name}</span>
                <span className="text-white font-mono">{formatNumber(t.row_count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backups */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Archive size={14} /> Database Backups</h3>
        {backups.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic">No backups found</div>
        ) : (
          <div className="space-y-1">
            {backups.map(b => (
              <div key={b.filename} className="flex items-center justify-between bg-[#0c0c0c] px-2 py-1.5 rounded-sm">
                <div>
                  <div className="text-[11px] font-mono text-gray-300">{b.filename}</div>
                  <div className="text-[9px] text-gray-500">{b.size_mb} MB — {safeDateTimeStr(b.created_at)}</div>
                </div>
                <button onClick={() => handleDeleteBackup(b.filename)} className="px-2 py-1 bg-red-900/40 hover:bg-red-800/60 text-red-400 text-[10px] rounded-sm"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Impersonation */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-yellow-400 uppercase mb-2 flex items-center gap-1.5"><UserCheck size={14} /> User Impersonation</h3>
        <p className="text-[10px] text-gray-500 mb-2">Generate a 30-minute token to act as another user. All actions are audit-logged under your admin account.</p>
        <div className="flex items-center gap-2">
          <select
            value={impersonateUserId}
            onChange={e => setImpersonateUserId(e.target.value)}
            className="flex-1 bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white"
          >
            <option value="">Select user...</option>
            {users.filter((u: any) => u.role !== 'admin').map((u: any) => (
              <option key={u.id} value={u.id}>{u.full_name || u.username} ({u.role}) — {u.call_sign || u.badge_number || 'N/A'}</option>
            ))}
          </select>
          <button onClick={handleImpersonate} disabled={!impersonateUserId} className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white flex items-center gap-1">
            <Eye size={12} /> Impersonate
          </button>
        </div>
      </div>

      {/* Notification Broadcast */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Bell size={14} /> Broadcast Notification</h3>
        <div className="space-y-2">
          <input
            type="text"
            value={broadcastTitle}
            onChange={e => setBroadcastTitle(e.target.value)}
            placeholder="Notification title..."
            className="w-full bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600"
          />
          <RichTextArea
            value={broadcastMessage}
            onChange={e => setBroadcastMessage(e.target.value)}
            placeholder="Message body..."
            rows={3}
            className="w-full bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600 resize-none"
          />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500">Target:</span>
            {['officer', 'dispatcher', 'supervisor', 'manager'].map(role => (
              <label key={role} className="flex items-center gap-1 text-[10px] text-gray-400">
                <input
                  type="checkbox"
                  checked={broadcastRoles.includes(role)}
                  onChange={e => setBroadcastRoles(prev => e.target.checked ? [...prev, role] : prev.filter(r => r !== role))}
                  className="rounded-sm"
                />
                {role}
              </label>
            ))}
            <span className="text-[9px] text-gray-600">(none = all users)</span>
          </div>
          <button onClick={handleBroadcast} disabled={!broadcastTitle.trim() || !broadcastMessage.trim()} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white flex items-center gap-1">
            <Bell size={12} /> Send Broadcast
          </button>
        </div>
      </div>

      {/* Data Purge Tools */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-red-400 uppercase mb-2 flex items-center gap-1.5"><Trash2 size={14} /> Data Purge Tools</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#0c0c0c] p-2 rounded-sm">
            <div className="text-[10px] text-gray-400 mb-1">Activity Logs</div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Keep</span>
              <input type="number" value={purgeLogDays} onChange={e => setPurgeLogDays(Number(e.target.value))} min={1} max={365} className="w-16 bg-[#141414] border border-[#2a2a2a] rounded-sm px-1.5 py-1 text-[11px] text-white text-center" />
              <span className="text-[10px] text-gray-500">days</span>
              <button onClick={handlePurgeLogs} className="ml-auto px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-300 text-[10px] rounded-sm font-bold">Purge</button>
            </div>
          </div>
          <div className="bg-[#0c0c0c] p-2 rounded-sm">
            <div className="text-[10px] text-gray-400 mb-1">Read Notifications</div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Keep</span>
              <input type="number" value={purgeNotifDays} onChange={e => setPurgeNotifDays(Number(e.target.value))} min={1} max={365} className="w-16 bg-[#141414] border border-[#2a2a2a] rounded-sm px-1.5 py-1 text-[11px] text-white text-center" />
              <span className="text-[10px] text-gray-500">days</span>
              <button onClick={handlePurgeNotifs} className="ml-auto px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-300 text-[10px] rounded-sm font-bold">Purge</button>
            </div>
          </div>
          <div className="bg-[#0c0c0c] p-2 rounded-sm">
            <div className="text-[10px] text-gray-400 mb-1">Expired Sessions</div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Remove all expired tokens</span>
              <button onClick={handlePurgeSessions} className="ml-auto px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-300 text-[10px] rounded-sm font-bold">Purge</button>
            </div>
          </div>
        </div>
      </div>

      {/* User Presence */}
      {userPresence && (
        <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Users size={14} /> User Presence</h3>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-[#0c0c0c] px-2 py-1.5 rounded-sm text-center">
              <div className="text-[9px] text-gray-500 uppercase">Online</div>
              <div className="text-[14px] font-mono font-bold text-green-400">{userPresence.online || 0}</div>
            </div>
            <div className="bg-[#0c0c0c] px-2 py-1.5 rounded-sm text-center">
              <div className="text-[9px] text-gray-500 uppercase">Idle</div>
              <div className="text-[14px] font-mono font-bold text-yellow-400">{userPresence.idle || 0}</div>
            </div>
            <div className="bg-[#0c0c0c] px-2 py-1.5 rounded-sm text-center">
              <div className="text-[9px] text-gray-500 uppercase">Offline</div>
              <div className="text-[14px] font-mono font-bold text-gray-500">{userPresence.offline || 0}</div>
            </div>
          </div>
          {userPresence.users && userPresence.users.length > 0 && (
            <div className="bg-[#0c0c0c] rounded-sm p-2 max-h-40 overflow-y-auto">
              {userPresence.users.map((u: any, i: number) => (
                <div key={i} className="flex items-center gap-2 py-0.5 border-b border-[#181818]/50 text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${u.status === 'online' ? 'bg-green-400' : u.status === 'idle' ? 'bg-yellow-400' : 'bg-[#2b2b2b]'}`} />
                  <span className="text-gray-300 font-mono">{u.username || u.full_name}</span>
                  <span className="text-gray-600 text-[9px]">{(u.role || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
                  {u.last_seen && <span className="text-gray-600 text-[9px] ml-auto">{new Date(u.last_seen).toLocaleTimeString()}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* WebSocket Clients */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Radio size={14} /> WebSocket Clients</h3>
        {wsClients.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic">No connected clients</div>
        ) : (
          <div className="bg-[#0c0c0c] rounded-sm overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#181818]">
                  <th className="text-left px-2 py-1 text-gray-500 font-normal">User ID</th>
                  <th className="text-left px-2 py-1 text-gray-500 font-normal">Username</th>
                  <th className="text-left px-2 py-1 text-gray-500 font-normal">Role</th>
                  <th className="text-left px-2 py-1 text-gray-500 font-normal">IP</th>
                  <th className="text-left px-2 py-1 text-gray-500 font-normal">Connected</th>
                </tr>
              </thead>
              <tbody>
                {wsClients.map((c: any, i: number) => (
                  <tr key={i} className="border-b border-[#181818]/50">
                    <td className="px-2 py-1 font-mono text-gray-400">{c.userId}</td>
                    <td className="px-2 py-1 text-white">{c.username}</td>
                    <td className="px-2 py-1 text-gray-400">{(c.role || '').replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase())}</td>
                    <td className="px-2 py-1 font-mono text-gray-500">{c.ip}</td>
                    <td className="px-2 py-1 text-gray-500">{c.connectedAt ? new Date(c.connectedAt).toLocaleTimeString() : c.duration || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk Call Operations */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-yellow-400 uppercase mb-2 flex items-center gap-1.5"><Globe size={14} /> Bulk Call Operations</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Bulk Reassign */}
          <div className="bg-[#0c0c0c] p-2 rounded-sm space-y-2">
            <div className="text-[10px] text-gray-400 font-bold uppercase">Bulk Reassign Calls</div>
            <RichTextArea
              value={reassignCallIds}
              onChange={e => setReassignCallIds(e.target.value)}
              placeholder="Call IDs (comma-separated): 101, 102, 103"
              rows={2}
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-sm px-2 py-1 text-[11px] text-white placeholder-gray-600 resize-none font-mono"
            />
            <select
              value={reassignTargetId}
              onChange={e => setReassignTargetId(e.target.value)}
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white"
            >
              <option value="">Target officer...</option>
              {users.filter((u: any) => ['officer', 'supervisor'].includes(u.role)).map((u: any) => (
                <option key={u.id} value={u.id}>{u.full_name || u.username} ({u.call_sign || u.badge_number || 'N/A'})</option>
              ))}
            </select>
            <button onClick={handleBulkReassign} disabled={!reassignCallIds || !reassignTargetId} className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white">
              Reassign Calls
            </button>
          </div>
          {/* Force Close All */}
          <div className="bg-[#0c0c0c] p-2 rounded-sm space-y-2">
            <div className="text-[10px] text-gray-400 font-bold uppercase">Force Close All Open Calls</div>
            <input
              type="text"
              value={closeDisposition}
              onChange={e => setCloseDisposition(e.target.value)}
              placeholder="Disposition..."
              className="w-full bg-[#141414] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600"
            />
            <button onClick={handleForceCloseAll} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-sm text-[11px] font-bold text-white">
              Force Close ALL Open Calls
            </button>
          </div>
        </div>
      </div>

      {/* SQL Query Console */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-red-400 uppercase mb-2 flex items-center gap-1.5"><Terminal size={14} /> SQL Query Console</h3>
        <p className="text-[9px] text-gray-500 mb-2">Direct database access. Use with caution — queries run against the live production database.</p>
        <RichTextArea
          value={sqlQuery}
          onChange={e => setSqlQuery(e.target.value)}
          placeholder="SELECT * FROM users LIMIT 10;"
          rows={4}
          className="w-full bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600 resize-y font-mono"
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={handleSqlQuery} disabled={sqlRunning || !sqlQuery.trim()} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white flex items-center gap-1">
            {sqlRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run Query
          </button>
          <button onClick={() => { setSqlQuery(''); setSqlResult(null); }} className="px-3 py-1.5 bg-[#181818] hover:bg-[#313131] border border-[#2a2a2a] rounded-sm text-[11px] text-gray-300">
            Clear
          </button>
        </div>
        {sqlResult && (
          <div className="mt-2 bg-[#0c0c0c] rounded-sm p-2 max-h-60 overflow-auto">
            {sqlResult.error ? (
              <div className="text-red-400 text-[11px] font-mono">{sqlResult.error}</div>
            ) : sqlResult.rows ? (
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-[#181818]">
                    {sqlResult.columns?.map((col: string) => (
                      <th key={col} className="text-left px-1.5 py-1 text-gray-500 font-normal whitespace-nowrap">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sqlResult.rows.map((row: any, i: number) => (
                    <tr key={i} className="border-b border-[#181818]/30">
                      {sqlResult.columns?.map((col: string) => (
                        <td key={col} className="px-1.5 py-0.5 text-gray-300 whitespace-nowrap max-w-[200px] truncate">{String(row[col] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-green-400 text-[11px] font-mono">
                {sqlResult.changes !== undefined ? `${sqlResult.changes} rows affected` : 'Query executed successfully'}
              </div>
            )}
            {sqlResult.row_count !== undefined && (
              <div className="text-[9px] text-gray-500 mt-1">{sqlResult.row_count} rows returned</div>
            )}
          </div>
        )}
      </div>

      {/* Emergency Lockdown */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-red-400 uppercase mb-2 flex items-center gap-1.5">
          {lockdownStatus?.active ? <Lock size={14} /> : <Unlock size={14} />} Emergency Lockdown
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-[11px] font-bold ${lockdownStatus?.active ? 'bg-red-900/60 text-red-300 border border-red-700/40' : 'bg-green-900/40 text-green-300 border border-green-700/40'}`}>
            <span className={`w-2 h-2 rounded-full ${lockdownStatus?.active ? 'bg-red-400 animate-pulse' : 'bg-green-400'}`} />
            {lockdownStatus?.active ? 'LOCKDOWN ACTIVE' : 'System Normal'}
          </div>
        </div>
        {!lockdownStatus?.active && (
          <div className="space-y-2 mb-3">
            <input
              type="text"
              value={lockdownMessage}
              onChange={e => setLockdownMessage(e.target.value)}
              placeholder="Lockdown message..."
              className="w-full bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600"
            />
            <label className="flex items-center gap-2 text-[10px] text-gray-400">
              <input
                type="checkbox"
                checked={lockdownKickSessions}
                onChange={e => setLockdownKickSessions(e.target.checked)}
                className="rounded-sm"
              />
              Kick all non-admin sessions immediately
            </label>
          </div>
        )}
        <button onClick={handleToggleLockdown} className={`px-4 py-1.5 rounded-sm text-[11px] font-bold text-white flex items-center gap-1 ${lockdownStatus?.active ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'}`}>
          {lockdownStatus?.active ? <><Unlock size={12} /> Disable Lockdown</> : <><Lock size={12} /> Enable Lockdown</>}
        </button>
      </div>

      {/* Merge Person Records */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Merge size={14} /> Merge Person Records</h3>
        <p className="text-[9px] text-gray-500 mb-2">Merge duplicate person records. The "merge" record will be deleted and all associated records reassigned to the "keep" record.</p>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-[9px] text-gray-500 uppercase">Keep (Primary ID)</label>
            <input
              type="number"
              value={mergeKeepId}
              onChange={e => setMergeKeepId(e.target.value)}
              placeholder="ID to keep"
              className="w-full bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600 font-mono"
            />
          </div>
          <div className="flex-1">
            <label className="text-[9px] text-gray-500 uppercase">Merge (Duplicate ID)</label>
            <input
              type="number"
              value={mergeMergeId}
              onChange={e => setMergeMergeId(e.target.value)}
              placeholder="ID to merge"
              className="w-full bg-[#0c0c0c] border border-[#2a2a2a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600 font-mono"
            />
          </div>
          <button onClick={handleMergePersons} disabled={!mergeKeepId || !mergeMergeId} className="mt-3 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white flex items-center gap-1">
            <Merge size={12} /> Merge
          </button>
        </div>
      </div>

      {/* Full System Export */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Download size={14} /> Full System Export</h3>
        <p className="text-[9px] text-gray-500 mb-2">Download a complete JSON export of all system data (users, calls, reports, persons, vehicles, etc.).</p>
        <button onClick={handleFullExport} className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded-sm text-[11px] font-bold text-white flex items-center gap-1">
          <Download size={12} /> Download Full Export
        </button>
      </div>

      {/* Live Activity Feed */}
      <div className="bg-[#141414] border border-[#181818] rounded-sm p-3">
        <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1.5"><Clock size={14} /> Live Activity Feed</h3>
        {activityFeed.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic">No recent activity</div>
        ) : (
          <div className="bg-[#0c0c0c] rounded-sm p-2 max-h-60 overflow-y-auto space-y-0.5">
            {activityFeed.map((a: any, i: number) => (
              <div key={i} className="flex items-start gap-2 py-1 border-b border-[#181818]/50 text-[10px]">
                <span className="text-gray-600 font-mono whitespace-nowrap min-w-[60px]">
                  {a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '—'}
                </span>
                <span className="text-gray-400 font-bold min-w-[80px] truncate">{a.username || a.user || '—'}</span>
                <span className="text-yellow-400 min-w-[60px]">{a.action || '—'}</span>
                <span className="text-gray-500">{a.entity_type || ''}</span>
                <span className="text-gray-600 truncate max-w-[300px]">{a.details ? (typeof a.details === 'string' ? a.details.slice(0, 80) : safeStr(a.details)) : ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#0c0c0c] px-2 py-1.5 rounded-sm">
      <div className="text-[9px] text-gray-500 uppercase">{label}</div>
      <div className={`text-[12px] font-mono font-bold ${color || 'text-white'}`}>{value}</div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, color }: { icon: any; label: string; onClick: () => void; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-gray-900/40 hover:bg-gray-800/60 text-gray-300 border-gray-700/30',
    green: 'bg-green-900/40 hover:bg-green-800/60 text-green-300 border-green-700/30',
    red: 'bg-red-900/40 hover:bg-red-800/60 text-red-300 border-red-700/30',
    yellow: 'bg-yellow-900/40 hover:bg-yellow-800/60 text-yellow-300 border-yellow-700/30',
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-sm text-[11px] font-bold ${colorMap[color] || colorMap.blue}`}>
      <Icon size={14} /> {label}
    </button>
  );
}
