import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import {
  Shield, Database, Users, Bell, Trash2, RefreshCw, Download,
  HardDrive, Activity, UserCheck, AlertTriangle, CheckCircle,
  Play, Archive, BarChart3, Loader2, Copy, Eye
} from 'lucide-react';

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

  const formatNumber = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-red-400" />
          <h2 className="text-sm font-bold text-red-400 uppercase tracking-wider">God Mode — Admin Control Panel</h2>
        </div>
        <button onClick={loadData} disabled={loading} className="flex items-center gap-1 px-2 py-1 bg-[#1a2636] hover:bg-[#243447] border border-[#2a3a4a] rounded-sm text-[11px] text-gray-300">
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
      {systemOverview && (
        <div className="bg-[#141e2b] border border-[#1a2636] rounded-sm p-3">
          <h3 className="text-xs font-bold text-blue-400 uppercase mb-2 flex items-center gap-1.5"><Activity size={14} /> System Overview</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            <StatBox label="Uptime" value={systemOverview.server.uptime} />
            <StatBox label="Node" value={systemOverview.server.node_version} />
            <StatBox label="CPUs" value={String(systemOverview.server.cpus)} />
            <StatBox label="Memory" value={`${systemOverview.server.free_memory_gb}/${systemOverview.server.total_memory_gb} GB`} />
            <StatBox label="Load" value={systemOverview.server.load_average.join(' / ')} />
            <StatBox label="Active Users (24h)" value={String(systemOverview.active_users_24h)} />
          </div>
          <div className="mt-2 grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-1">
            {Object.entries(systemOverview.record_counts).filter(([, v]) => v >= 0).map(([table, count]) => (
              <div key={table} className="bg-[#0d1520] px-2 py-1 rounded-sm">
                <div className="text-[9px] text-gray-500 uppercase truncate">{table.replace(/_/g, ' ')}</div>
                <div className="text-[11px] font-mono text-white">{formatNumber(count)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Database Maintenance */}
      {dbStats && (
        <div className="bg-[#141e2b] border border-[#1a2636] rounded-sm p-3">
          <h3 className="text-xs font-bold text-blue-400 uppercase mb-2 flex items-center gap-1.5"><Database size={14} /> Database Maintenance</h3>
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
          <div className="bg-[#0d1520] rounded-sm p-2 max-h-40 overflow-y-auto">
            <div className="text-[9px] text-gray-500 uppercase mb-1">Top Tables by Row Count</div>
            {dbStats.tables.slice(0, 15).map(t => (
              <div key={t.name} className="flex justify-between text-[11px] py-0.5 border-b border-[#1a2636]/50">
                <span className="text-gray-300 font-mono">{t.name}</span>
                <span className="text-white font-mono">{formatNumber(t.row_count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Backups */}
      <div className="bg-[#141e2b] border border-[#1a2636] rounded-sm p-3">
        <h3 className="text-xs font-bold text-blue-400 uppercase mb-2 flex items-center gap-1.5"><Archive size={14} /> Database Backups</h3>
        {backups.length === 0 ? (
          <div className="text-[11px] text-gray-500 italic">No backups found</div>
        ) : (
          <div className="space-y-1">
            {backups.map(b => (
              <div key={b.filename} className="flex items-center justify-between bg-[#0d1520] px-2 py-1.5 rounded-sm">
                <div>
                  <div className="text-[11px] font-mono text-gray-300">{b.filename}</div>
                  <div className="text-[9px] text-gray-500">{b.size_mb} MB — {new Date(b.created_at).toLocaleString()}</div>
                </div>
                <button onClick={() => handleDeleteBackup(b.filename)} className="px-2 py-1 bg-red-900/40 hover:bg-red-800/60 text-red-400 text-[10px] rounded-sm"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Impersonation */}
      <div className="bg-[#141e2b] border border-[#1a2636] rounded-sm p-3">
        <h3 className="text-xs font-bold text-yellow-400 uppercase mb-2 flex items-center gap-1.5"><UserCheck size={14} /> User Impersonation</h3>
        <p className="text-[10px] text-gray-500 mb-2">Generate a 30-minute token to act as another user. All actions are audit-logged under your admin account.</p>
        <div className="flex items-center gap-2">
          <select
            value={impersonateUserId}
            onChange={e => setImpersonateUserId(e.target.value)}
            className="flex-1 bg-[#0d1520] border border-[#2a3a4a] rounded-sm px-2 py-1.5 text-[11px] text-white"
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
      <div className="bg-[#141e2b] border border-[#1a2636] rounded-sm p-3">
        <h3 className="text-xs font-bold text-blue-400 uppercase mb-2 flex items-center gap-1.5"><Bell size={14} /> Broadcast Notification</h3>
        <div className="space-y-2">
          <input
            type="text"
            value={broadcastTitle}
            onChange={e => setBroadcastTitle(e.target.value)}
            placeholder="Notification title..."
            className="w-full bg-[#0d1520] border border-[#2a3a4a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600"
          />
          <textarea
            value={broadcastMessage}
            onChange={e => setBroadcastMessage(e.target.value)}
            placeholder="Message body..."
            rows={3}
            className="w-full bg-[#0d1520] border border-[#2a3a4a] rounded-sm px-2 py-1.5 text-[11px] text-white placeholder-gray-600 resize-none"
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
          <button onClick={handleBroadcast} disabled={!broadcastTitle.trim() || !broadcastMessage.trim()} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white flex items-center gap-1">
            <Bell size={12} /> Send Broadcast
          </button>
        </div>
      </div>

      {/* Data Purge Tools */}
      <div className="bg-[#141e2b] border border-[#1a2636] rounded-sm p-3">
        <h3 className="text-xs font-bold text-red-400 uppercase mb-2 flex items-center gap-1.5"><Trash2 size={14} /> Data Purge Tools</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-[#0d1520] p-2 rounded-sm">
            <div className="text-[10px] text-gray-400 mb-1">Activity Logs</div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Keep</span>
              <input type="number" value={purgeLogDays} onChange={e => setPurgeLogDays(Number(e.target.value))} min={1} max={365} className="w-16 bg-[#141e2b] border border-[#2a3a4a] rounded-sm px-1.5 py-1 text-[11px] text-white text-center" />
              <span className="text-[10px] text-gray-500">days</span>
              <button onClick={handlePurgeLogs} className="ml-auto px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-300 text-[10px] rounded-sm font-bold">Purge</button>
            </div>
          </div>
          <div className="bg-[#0d1520] p-2 rounded-sm">
            <div className="text-[10px] text-gray-400 mb-1">Read Notifications</div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Keep</span>
              <input type="number" value={purgeNotifDays} onChange={e => setPurgeNotifDays(Number(e.target.value))} min={1} max={365} className="w-16 bg-[#141e2b] border border-[#2a3a4a] rounded-sm px-1.5 py-1 text-[11px] text-white text-center" />
              <span className="text-[10px] text-gray-500">days</span>
              <button onClick={handlePurgeNotifs} className="ml-auto px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-300 text-[10px] rounded-sm font-bold">Purge</button>
            </div>
          </div>
          <div className="bg-[#0d1520] p-2 rounded-sm">
            <div className="text-[10px] text-gray-400 mb-1">Expired Sessions</div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Remove all expired tokens</span>
              <button onClick={handlePurgeSessions} className="ml-auto px-2 py-1 bg-red-900/60 hover:bg-red-800/80 text-red-300 text-[10px] rounded-sm font-bold">Purge</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#0d1520] px-2 py-1.5 rounded-sm">
      <div className="text-[9px] text-gray-500 uppercase">{label}</div>
      <div className={`text-[12px] font-mono font-bold ${color || 'text-white'}`}>{value}</div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, color }: { icon: any; label: string; onClick: () => void; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-900/40 hover:bg-blue-800/60 text-blue-300 border-blue-700/30',
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
