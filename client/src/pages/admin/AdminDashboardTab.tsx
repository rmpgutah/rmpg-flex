// ============================================================
// RMPG Flex — Admin Dashboard
// Central command view: system health, user stats, record counts,
// integration status, recent audit events, and quick actions.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Database,
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Wifi,
  BarChart3,
  TrendingUp,
  FileText,
  Car,
  Building2,
  Package,
  Briefcase,
  Gavel,
  Radio,
  Zap,
  Eye,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface DashboardData {
  // System
  serverVersion: string;
  uptime: string;
  dbSizeMB: number;
  // Users
  totalUsers: number;
  activeUsers: number;
  activeSessions: number;
  lockedAccounts: number;
  // Records
  totalPersons: number;
  totalVehicles: number;
  totalProperties: number;
  totalBusinesses: number;
  totalEvidence: number;
  totalWarrants: number;
  totalCitations: number;
  totalIncidents: number;
  // Dispatch
  activeCalls: number;
  callsToday: number;
  pendingServe: number;
  // Recent
  recentAudit: { action: string; user_name: string; created_at: string }[];
}

interface AdminDashboardTabProps {
  LoadingSpinner: React.FC;
  onNavigate: (tabId: string) => void;
}

function StatCard({ icon: Icon, label, value, color, sub, onClick }: {
  icon: React.ElementType; label: string; value: string | number; color: string; sub?: string; onClick?: () => void;
}) {
  return (
    <div className={`panel-beveled p-3 ${onClick ? 'cursor-pointer hover:bg-rmpg-700/30' : ''} transition-colors`} onClick={onClick}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider">{label}</span>
      </div>
      <div className="text-xl font-bold text-white font-mono tabular-nums">{value}</div>
      {sub && <div className="text-[9px] text-rmpg-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusIndicator({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-rmpg-800/30 last:border-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-red-500'}`} style={{ boxShadow: ok ? '0 0 4px #22c55e' : '0 0 4px #ef4444' }} />
      <span className="text-[11px] text-rmpg-200 flex-1">{label}</span>
      <span className={`text-[9px] ${ok ? 'text-green-400' : 'text-red-400'}`}>{ok ? 'Online' : 'Offline'}</span>
      {detail && <span className="text-[9px] text-rmpg-500">{detail}</span>}
    </div>
  );
}

export default function AdminDashboardTab({ LoadingSpinner, onNavigate }: AdminDashboardTabProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      // Fetch multiple endpoints in parallel
      const [health, users, recordCounts, auditRecent] = await Promise.all([
        apiFetch<any>('/admin/health').catch(() => ({})),
        apiFetch<any[]>('/admin/users').catch(() => []),
        apiFetch<any>('/admin/record-counts').catch(() => ({})),
        apiFetch<any[]>('/admin/audit-log?limit=10').catch(() => []),
      ]);

      const activeUsers = (users || []).filter((u: any) => u.status === 'active' || u.is_active);
      const lockedUsers = (users || []).filter((u: any) => u.locked_until);

      setData({
        serverVersion: health.version || '—',
        uptime: health.uptime || '—',
        dbSizeMB: health.dbSizeMB || 0,
        totalUsers: (users || []).length,
        activeUsers: activeUsers.length,
        activeSessions: health.activeSessions || 0,
        lockedAccounts: lockedUsers.length,
        totalPersons: recordCounts.persons || 0,
        totalVehicles: recordCounts.vehicles || 0,
        totalProperties: recordCounts.properties || 0,
        totalBusinesses: recordCounts.businesses || 0,
        totalEvidence: recordCounts.evidence || 0,
        totalWarrants: recordCounts.warrants || 0,
        totalCitations: recordCounts.citations || 0,
        totalIncidents: recordCounts.incidents || 0,
        activeCalls: recordCounts.activeCalls || 0,
        callsToday: recordCounts.callsToday || 0,
        pendingServe: recordCounts.pendingServe || 0,
        recentAudit: (auditRecent || []).slice(0, 8),
      });
    } catch { /* silent */ }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { fetchDashboard(); }, []);
  useEffect(() => { document.title = 'Admin Dashboard — RMPG Flex'; }, []);

  if (loading) return <LoadingSpinner />;
  if (!data) return <div className="p-4 text-rmpg-400">Failed to load dashboard data.</div>;

  return (
    <div className="p-4 space-y-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-brand-900/30 border border-brand-700/50">
            <BarChart3 className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Admin Dashboard</h2>
            <p className="text-[10px] text-rmpg-400">System overview · v{data.serverVersion}</p>
          </div>
        </div>
        <button type="button" onClick={() => fetchDashboard(true)} disabled={refreshing} className="toolbar-btn">
          {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {/* System Status */}
      <div className="panel-beveled p-4">
        <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> System Status
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusIndicator label="API Server" ok={true} detail={`v${data.serverVersion}`} />
          <StatusIndicator label="Database" ok={true} detail={`${data.dbSizeMB}MB`} />
          <StatusIndicator label="WebSocket" ok={true} />
          <StatusIndicator label="Uptime" ok={true} detail={data.uptime} />
        </div>
      </div>

      {/* User Metrics */}
      <div>
        <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> User Metrics
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatCard icon={Users} label="Total Users" value={data.totalUsers} color="text-gray-400" onClick={() => onNavigate('users')} />
          <StatCard icon={CheckCircle} label="Active Users" value={data.activeUsers} color="text-green-400" onClick={() => onNavigate('users')} />
          <StatCard icon={Wifi} label="Active Sessions" value={data.activeSessions} color="text-blue-400" onClick={() => onNavigate('sessions')} />
          <StatCard icon={AlertTriangle} label="Locked Accounts" value={data.lockedAccounts} color={data.lockedAccounts > 0 ? 'text-red-400' : 'text-gray-400'} onClick={() => onNavigate('users')} />
        </div>
      </div>

      {/* Record Counts */}
      <div>
        <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" /> Record Counts
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <StatCard icon={Users} label="Persons" value={data.totalPersons} color="text-brand-400" />
          <StatCard icon={Car} label="Vehicles" value={data.totalVehicles} color="text-green-400" />
          <StatCard icon={Building2} label="Properties" value={data.totalProperties} color="text-purple-400" />
          <StatCard icon={Briefcase} label="Businesses" value={data.totalBusinesses} color="text-purple-400" />
          <StatCard icon={Package} label="Evidence" value={data.totalEvidence} color="text-amber-400" />
          <StatCard icon={Gavel} label="Warrants" value={data.totalWarrants} color="text-red-400" />
          <StatCard icon={FileText} label="Citations" value={data.totalCitations} color="text-blue-400" />
          <StatCard icon={FileText} label="Incidents" value={data.totalIncidents} color="text-amber-400" />
        </div>
      </div>

      {/* Dispatch Overview */}
      <div>
        <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5" /> Dispatch Overview
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <StatCard icon={Zap} label="Active Calls" value={data.activeCalls} color="text-green-400" sub="Currently dispatched" />
          <StatCard icon={TrendingUp} label="Calls Today" value={data.callsToday} color="text-brand-400" sub="Since midnight" />
          <StatCard icon={Clock} label="Pending Serve" value={data.pendingServe} color="text-amber-400" sub="Awaiting service" />
        </div>
      </div>

      {/* Recent Audit Activity */}
      <div className="panel-beveled p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Recent Activity
          </h3>
          <button type="button" onClick={() => onNavigate('audit')} className="text-[9px] text-brand-400 hover:underline">View All →</button>
        </div>
        {data.recentAudit.length > 0 ? (
          <div className="space-y-1">
            {data.recentAudit.map((event, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-rmpg-800/30 last:border-0">
                <span className="text-rmpg-500 font-mono text-[9px] w-28 flex-shrink-0">
                  {new Date(event.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-rmpg-300 flex-1 truncate">{(event.action || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                <span className="text-rmpg-500 text-[9px]">{event.user_name || '—'}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-rmpg-500">No recent activity</p>
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" /> Quick Actions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <button type="button" onClick={() => onNavigate('users')} className="panel-beveled p-3 text-left hover:bg-rmpg-700/30 transition-colors">
            <Users className="w-4 h-4 text-brand-400 mb-1" />
            <span className="text-[10px] font-bold text-white block">Manage Users</span>
            <span className="text-[9px] text-rmpg-500">Add, edit, reset passwords</span>
          </button>
          <button type="button" onClick={() => onNavigate('branding')} className="panel-beveled p-3 text-left hover:bg-rmpg-700/30 transition-colors">
            <FileText className="w-4 h-4 text-purple-400 mb-1" />
            <span className="text-[10px] font-bold text-white block">PDF Branding</span>
            <span className="text-[9px] text-rmpg-500">Agency identity, colors</span>
          </button>
          <button type="button" onClick={() => onNavigate('security')} className="panel-beveled p-3 text-left hover:bg-rmpg-700/30 transition-colors">
            <Shield className="w-4 h-4 text-red-400 mb-1" />
            <span className="text-[10px] font-bold text-white block">Security Policy</span>
            <span className="text-[9px] text-rmpg-500">2FA, lockout, passwords</span>
          </button>
          <button type="button" onClick={() => onNavigate('audit')} className="panel-beveled p-3 text-left hover:bg-rmpg-700/30 transition-colors">
            <Eye className="w-4 h-4 text-amber-400 mb-1" />
            <span className="text-[10px] font-bold text-white block">Audit Log</span>
            <span className="text-[9px] text-rmpg-500">Full activity history</span>
          </button>
        </div>
      </div>
    </div>
  );
}
