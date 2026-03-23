// ============================================================
// RMPG Flex — HR Dashboard Tab
// Manager view: org-wide metrics, compliance, activity feed
// Officer view: personal leave balances, quick actions
// ============================================================

import { useState, useEffect } from 'react';
import {
  Users, UserPlus, CalendarOff, Clock, ShieldCheck, AlertTriangle,
  Activity, ChevronRight, Loader2, Bell, TrendingUp, DollarSign, Star,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';

interface DashboardData {
  total_active: number;
  new_hires_30d: number;
  on_leave_today: number;
  pending_approvals: number;
  training_compliance_pct: number;
  credential_compliance_pct: number;
  overdue_items: number;
  recent_activity: ActivityItem[];
}

interface ActivityItem {
  id: number;
  type: string;
  description: string;
  officer_name: string;
  created_at: string;
}

interface LeaveBalances {
  vacation_total: number;
  vacation_used: number;
  sick_total: number;
  sick_used: number;
  personal_total: number;
  personal_used: number;
}

const MANAGER_ROLES = ['admin', 'manager', 'supervisor'];

function activityColor(type: string): string {
  switch (type) {
    case 'leave_request': return '#f59e0b';
    case 'leave_approved': return '#22c55e';
    case 'disciplinary': return '#ef4444';
    case 'review': return '#3b82f6';
    case 'commendation': return '#8b5cf6';
    default: return '#6b7280';
  }
}

function activityIcon(type: string) {
  switch (type) {
    case 'leave_request':
    case 'leave_approved':
      return CalendarOff;
    case 'disciplinary':
      return AlertTriangle;
    case 'review':
      return ShieldCheck;
    default:
      return Activity;
  }
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Metric Card ────────────────────────────────────────────
function MetricCard({
  icon: Icon,
  label,
  value,
  accent = '#3b82f6',
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accent?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button"
      onClick={onClick}
      disabled={!onClick}
      className="bg-surface-base border border-rmpg-700 rounded-sm p-4 text-left transition-colors hover:border-rmpg-500 disabled:cursor-default"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} style={{ color: accent }} />
        <span className="text-xs text-rmpg-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </button>
  );
}

// ─── Progress Bar ───────────────────────────────────────────
function ProgressBar({ label, pct, color = '#3b82f6' }: { label: string; pct: number; color?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-rmpg-300">{label}</span>
        <span className="text-xs font-medium text-white">{pct}%</span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Balance Card (officer view) ────────────────────────────
function BalanceCard({
  label,
  used,
  total,
  color,
}: {
  label: string;
  used: number;
  total: number;
  color: string;
}) {
  const remaining = total - used;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
      <div className="text-xs text-rmpg-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-white mb-1">
        {remaining} <span className="text-sm font-normal text-rmpg-400">/ {total} remaining</span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-xs text-rmpg-500 mt-1">{used} used</div>
    </div>
  );
}

// ─── Manager Dashboard ──────────────────────────────────────
function ManagerDashboard({
  data,
  onNavigateToLeave,
}: {
  data: DashboardData;
  onNavigateToLeave: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Users} label="Total Active" value={data.total_active} accent="#3b82f6" />
        <MetricCard icon={UserPlus} label="New Hires (30d)" value={data.new_hires_30d} accent="#22c55e" />
        <MetricCard icon={CalendarOff} label="On Leave Today" value={data.on_leave_today} accent="#f59e0b" />
        <MetricCard
          icon={Clock}
          label="Pending Approvals"
          value={data.pending_approvals}
          accent={data.pending_approvals > 0 ? '#ef4444' : '#6b7280'}
          onClick={data.pending_approvals > 0 ? onNavigateToLeave : undefined}
        />
      </div>

      {/* Compliance */}
      <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <ShieldCheck size={14} className="text-blue-400" />
          Compliance Overview
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ProgressBar
            label="Training Compliance"
            pct={data.training_compliance_pct}
            color={data.training_compliance_pct >= 80 ? '#22c55e' : '#f59e0b'}
          />
          <ProgressBar
            label="Credential Compliance"
            pct={data.credential_compliance_pct}
            color={data.credential_compliance_pct >= 80 ? '#22c55e' : '#f59e0b'}
          />
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className={data.overdue_items > 0 ? 'text-red-400' : 'text-green-400'} />
            <div>
              <div className="text-xs text-rmpg-400">Overdue Items</div>
              <div className="text-lg font-bold text-white">{data.overdue_items}</div>
            </div>
          </div>
        </div>
      </div>

      {/* HR Notifications, OT Trends, Review Reminders, Disciplinary Points */}
      <HREnhancedPanels />

      {/* Recent Activity */}
      <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
        <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
          <Activity size={14} className="text-blue-400" />
          Recent HR Activity
        </h3>
        {data.recent_activity.length === 0 ? (
          <p className="text-xs text-rmpg-500">No recent activity</p>
        ) : (
          <div className="space-y-2">
            {data.recent_activity.map(item => {
              const Icon = activityIcon(item.type);
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 bg-surface-sunken border border-rmpg-700 rounded-sm p-2.5"
                >
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: activityColor(item.type) }}
                  />
                  <Icon size={14} className="text-rmpg-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white">{item.description}</div>
                    <div className="text-xs text-rmpg-500 mt-0.5">
                      {item.officer_name} &middot; {formatRelativeTime(item.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Officer Self-Service Dashboard ─────────────────────────
function OfficerDashboard({
  userId,
  onNavigateToLeave,
}: {
  userId: string;
  onNavigateToLeave: () => void;
}) {
  const [balances, setBalances] = useState<LeaveBalances | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const year = new Date().getFullYear();
    apiFetch<LeaveBalances>(`/hr/leave/balances?year=${year}`)
      .then(setBalances)
      .catch(() => setBalances(null))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-rmpg-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* PTO Balances */}
      {balances ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <BalanceCard label="Vacation" used={balances.vacation_used} total={balances.vacation_total} color="#3b82f6" />
          <BalanceCard label="Sick" used={balances.sick_used} total={balances.sick_total} color="#ef4444" />
          <BalanceCard label="Personal" used={balances.personal_used} total={balances.personal_total} color="#8b5cf6" />
        </div>
      ) : (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <p className="text-xs text-rmpg-500">Leave balances not available</p>
        </div>
      )}

      {/* Quick actions */}
      <button type="button"
        onClick={onNavigateToLeave}
        className="flex items-center gap-2 bg-surface-base border border-rmpg-700 rounded-sm px-4 py-3 text-sm text-white hover:border-brand-500 transition-colors w-full md:w-auto"
      >
        <CalendarOff size={14} className="text-amber-400" />
        Request Time Off
        <ChevronRight size={14} className="text-rmpg-500 ml-auto md:ml-2" />
      </button>

      {/* Placeholders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <h3 className="text-xs text-rmpg-400 uppercase tracking-wide mb-2">Next Performance Review</h3>
          <p className="text-xs text-rmpg-500">No upcoming reviews scheduled</p>
        </div>
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <h3 className="text-xs text-rmpg-400 uppercase tracking-wide mb-2">Expiring Credentials</h3>
          <p className="text-xs text-rmpg-500">No credentials expiring soon</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────
export default function HRDashboardTab({
  userRole,
  userId,
  onNavigateToLeave,
}: {
  userRole: string;
  userId: string;
  onNavigateToLeave: () => void;
}) {
  const isManager = MANAGER_ROLES.includes(userRole);
  const { addToast } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(isManager);

  useEffect(() => {
    if (!isManager) return;
    apiFetch<DashboardData>('/hr/dashboard')
      .then(setData)
      .catch(() => { setData(null); addToast('Failed to load HR dashboard', 'error'); })
      .finally(() => setLoading(false));
  }, [isManager]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-rmpg-400" />
      </div>
    );
  }

  return (
    <div className="p-4">
      {isManager && data ? (
        <ManagerDashboard data={data} onNavigateToLeave={onNavigateToLeave} />
      ) : isManager && !data ? (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <p className="text-xs text-rmpg-500">Unable to load HR dashboard data</p>
        </div>
      ) : (
        <OfficerDashboard userId={userId} onNavigateToLeave={onNavigateToLeave} />
      )}
    </div>
  );
}

// ─── Enhanced HR Panels (Notifications, OT, Reviews, Discipline) ──
function HREnhancedPanels() {
  const [hrNotifs, setHrNotifs] = useState<any[]>([]);
  const [overtimeTrends, setOvertimeTrends] = useState<any>(null);
  const [reviewReminders, setReviewReminders] = useState<any>(null);
  const [disciplinaryPoints, setDisciplinaryPoints] = useState<any>(null);
  const [hrAnalytics, setHrAnalytics] = useState<any>(null);

  useEffect(() => {
    apiFetch('/hr/notifications').then((d: any) => d?.notifications && setHrNotifs(d.notifications)).catch(() => {});
    apiFetch('/hr/overtime-trends').then((d: any) => d && setOvertimeTrends(d)).catch(() => {});
    apiFetch('/hr/review-reminders').then((d: any) => d && setReviewReminders(d)).catch(() => {});
    apiFetch('/hr/disciplinary-points').then((d: any) => d && setDisciplinaryPoints(d)).catch(() => {});
    apiFetch('/hr/analytics').then((d: any) => d && setHrAnalytics(d)).catch(() => {});
  }, []);

  return (
    <>
      {/* HR Notifications */}
      {hrNotifs.length > 0 && (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Bell size={14} className="text-amber-400" />
            HR Notifications ({hrNotifs.length})
          </h3>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {hrNotifs.slice(0, 8).map((n: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${n.severity === 'critical' ? 'bg-red-900/20 text-red-400' : n.severity === 'warning' ? 'bg-amber-900/20 text-amber-400' : 'bg-blue-900/20 text-blue-400'}`}>
                <AlertTriangle size={12} className="shrink-0" />
                <span className="truncate">{n.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Analytics Summary */}
      {hrAnalytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-surface-base border border-rmpg-700 rounded-sm p-3 text-center">
            <CalendarOff size={14} className="mx-auto text-amber-400 mb-1" />
            <div className="text-lg font-bold text-white">{hrAnalytics.leave_utilization?.utilization_pct || 0}%</div>
            <div className="text-[9px] text-rmpg-500 uppercase">Leave Utilization</div>
          </div>
          <div className="bg-surface-base border border-rmpg-700 rounded-sm p-3 text-center">
            <Clock size={14} className="mx-auto text-blue-400 mb-1" />
            <div className="text-lg font-bold text-white">{hrAnalytics.overtime_trends?.total_hours || 0}h</div>
            <div className="text-[9px] text-rmpg-500 uppercase">OT This Year</div>
          </div>
          <div className="bg-surface-base border border-rmpg-700 rounded-sm p-3 text-center">
            <Star size={14} className="mx-auto text-green-400 mb-1" />
            <div className="text-lg font-bold text-white">{hrAnalytics.review_stats?.completion_pct || 0}%</div>
            <div className="text-[9px] text-rmpg-500 uppercase">Review Completion</div>
          </div>
          <div className="bg-surface-base border border-rmpg-700 rounded-sm p-3 text-center">
            <AlertTriangle size={14} className="mx-auto text-red-400 mb-1" />
            <div className="text-lg font-bold text-white">{hrAnalytics.disciplinary_stats?.total_active || 0}</div>
            <div className="text-[9px] text-rmpg-500 uppercase">Active Disciplinary</div>
          </div>
        </div>
      )}

      {/* Overtime Trends */}
      {overtimeTrends && (overtimeTrends.pending?.count > 0 || overtimeTrends.top_officers?.length > 0) && (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <TrendingUp size={14} className="text-blue-400" />
            Overtime Overview
            {overtimeTrends.pending?.count > 0 && (
              <span className="ml-auto text-xs bg-amber-900/30 text-amber-400 px-2 py-0.5 rounded">{overtimeTrends.pending.count} pending ({overtimeTrends.pending.total_hours}h)</span>
            )}
          </h3>
          {overtimeTrends.top_officers?.length > 0 && (
            <div className="space-y-1">
              {overtimeTrends.top_officers.slice(0, 5).map((o: any) => (
                <div key={o.officer_id} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-xs">
                  <span className="text-rmpg-200">{o.officer_name}</span>
                  <span className="font-mono text-blue-400">{Math.round(o.total_hours * 10) / 10}h OT</span>
                  <span className="text-rmpg-500">{o.request_count} requests</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Review Reminders */}
      {reviewReminders && reviewReminders.total_overdue > 0 && (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <ShieldCheck size={14} className="text-amber-400" />
            Performance Review Reminders ({reviewReminders.total_overdue} overdue)
          </h3>
          <div className="space-y-1 max-h-[150px] overflow-y-auto">
            {reviewReminders.overdue_reviews?.slice(0, 8).map((r: any) => (
              <div key={r.officer_id} className="flex items-center justify-between px-2 py-1.5 bg-surface-sunken rounded text-xs">
                <span className="text-rmpg-200">{r.full_name}</span>
                <span className="text-rmpg-500">{r.badge_number}</span>
                <span className={`font-mono ${r.severity === 'critical' ? 'text-red-400' : r.severity === 'no_review' ? 'text-amber-400' : 'text-amber-400'}`}>
                  {r.days_since_review != null ? `${r.days_since_review}d since review` : 'Never reviewed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disciplinary Points */}
      {disciplinaryPoints?.officers?.length > 0 && (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <h3 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <AlertTriangle size={14} className="text-red-400" />
            Disciplinary Point System
          </h3>
          <div className="space-y-1">
            {disciplinaryPoints.officers.slice(0, 8).map((o: any) => (
              <div key={o.officer_id} className="flex items-center justify-between px-2 py-1.5 bg-surface-sunken rounded text-xs">
                <span className="text-rmpg-200">{o.officer_name}</span>
                <span className="text-rmpg-500">{o.badge_number}</span>
                <div className="flex items-center gap-2">
                  <span className={`font-mono font-bold ${o.risk_level === 'high' ? 'text-red-400' : o.risk_level === 'medium' ? 'text-amber-400' : 'text-green-400'}`}>
                    {o.points} pts
                  </span>
                  <span className={`text-[8px] uppercase px-1.5 py-0.5 rounded ${o.risk_level === 'high' ? 'bg-red-900/30 text-red-400' : o.risk_level === 'medium' ? 'bg-amber-900/30 text-amber-400' : 'bg-green-900/30 text-green-400'}`}>
                    {o.risk_level}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
