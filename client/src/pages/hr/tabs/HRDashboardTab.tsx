// ============================================================
// RMPG Flex — HR Dashboard Tab
// Manager view: org-wide metrics, compliance, activity feed
// Officer view: personal leave balances, quick actions
// ============================================================

import { useState, useEffect } from 'react';
import {
  Users, UserPlus, CalendarOff, Clock, ShieldCheck, AlertTriangle,
  Activity, ChevronRight, Loader2, FileWarning,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { useToast } from '../../../components/ToastProvider';
import { parseTimestamp } from '../../../utils/dateUtils';

interface DashboardData {
  total_active: number;
  new_hires_30d: number;
  on_leave_today: number;
  pending_approvals: number;
  // null = nothing tracked yet. Distinct from 0, which means "tracked and
  // failing" — the API stopped conflating the two.
  training_compliance_pct: number | null;
  credential_compliance_pct: number | null;
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

// Maximum disciplinary records shown in the dashboard summary panel.
// The full audit trail lives in DisciplinaryTab.
const DISC_DASHBOARD_LIMIT = 50;

interface DisciplinaryRecord {
  id: number;
  officer_name: string;
  incident_type: string;
  severity: string;
  status: string;
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

// Must match the server tier (hr.ts MANAGER_ROLES includes human_resources) —
// omitting it gave HR users the officer view while the server returned
// manager-scoped data.
const MANAGER_ROLES = ['admin', 'manager', 'supervisor', 'human_resources'];

function activityColor(type: string): string {
  switch (type) {
    case 'leave_request': return 'var(--sev-warn)';
    case 'leave_approved': return 'var(--sev-ok)';
    case 'disciplinary': return 'var(--sev-critical)';
    case 'review': return 'var(--text-muted)';
    case 'commendation': return 'var(--sev-special)';
    default: return 'var(--text-muted)';
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
  const diff = Date.now() - parseTimestamp(dateStr).getTime();
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
  accentClass = 'text-fg-muted',
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  accentClass?: string;
  onClick?: () => void;
}) {
  return (
    <button type="button"
      onClick={onClick}
      disabled={!onClick}
      className="bg-surface-base border border-rmpg-700 rounded-sm p-4 text-left transition-all duration-200 hover:border-border-strong hover:shadow-lg hover:brightness-110 disabled:cursor-default focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={accentClass} aria-hidden="true" />
        <span className="text-xs text-rmpg-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-rmpg-100 font-mono">{value}</div>
    </button>
  );
}

// ─── Progress Bar ───────────────────────────────────────────
function ProgressBar({ label, pct, colorClass = 'bg-fg-muted' }: { label: string; pct: number | null; colorClass?: string }) {
  // A null pct means the requirement set is empty (no mandatory courses / no
  // certifications on file). Rendering that as 0% claimed the department was
  // out of compliance, so show an explicit em dash and a neutral, empty track.
  const tracked = typeof pct === 'number';
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-rmpg-300">{label}</span>
        <span className="text-xs font-medium text-rmpg-100" title={tracked ? undefined : 'Not tracked yet — no requirements on file'}>
          {tracked ? `${pct}%` : '—'}
        </span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
        {tracked && (
          <div
            className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
            style={{ width: `${Math.min(pct as number, 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Balance Card (officer view) ────────────────────────────
function BalanceCard({
  label,
  used,
  total,
  colorClass,
}: {
  label: string;
  used: number;
  total: number;
  colorClass: string;
}) {
  const remaining = total - used;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;

  return (
    <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4 transition-all duration-200 hover:border-border-strong hover:brightness-105">
      <div className="text-xs text-rmpg-400 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-bold text-rmpg-100 mb-1 font-mono">
        {remaining} <span className="text-sm font-normal text-rmpg-400 font-sans">/ {total} remaining</span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pct}% used`}>
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
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
  onNavigateToDisciplinary,
}: {
  data: DashboardData;
  onNavigateToLeave: () => void;
  onNavigateToDisciplinary?: () => void;
}) {
  const [discRecords, setDiscRecords] = useState<DisciplinaryRecord[]>([]);
  const [discLoading, setDiscLoading] = useState(true);

  useEffect(() => {
    // Fetch only the most recent DISC_DASHBOARD_LIMIT records. The full
    // audit trail is available in DisciplinaryTab. This prevents the dashboard
    // from rendering an unbounded list and hitting the D1 100-param cap on
    // wide result sets.
    apiFetch<DisciplinaryRecord[]>(`/hr/disciplinary?limit=${DISC_DASHBOARD_LIMIT}`)
      .then((rows) => setDiscRecords(Array.isArray(rows) ? rows.slice(0, DISC_DASHBOARD_LIMIT) : []))
      .catch(() => setDiscRecords([]))
      .finally(() => setDiscLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" role="group" aria-label="HR metrics">
        <MetricCard icon={Users} label="Total Active" value={data.total_active} accentClass="text-fg-muted" />
        <MetricCard icon={UserPlus} label="New Hires (30d)" value={data.new_hires_30d} accentClass="text-green-500" />
        <MetricCard icon={CalendarOff} label="On Leave Today" value={data.on_leave_today} accentClass="text-amber-400" />
        <MetricCard
          icon={Clock}
          label="Pending Approvals"
          value={data.pending_approvals}
          accentClass={data.pending_approvals > 0 ? 'text-red-500' : 'text-fg-muted'}
          onClick={data.pending_approvals > 0 ? onNavigateToLeave : undefined}
        />
      </div>

      {/* Compliance */}
      <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
        <h3 className="text-sm font-medium text-rmpg-100 mb-3 flex items-center gap-2">
          <ShieldCheck size={14} className="text-rmpg-400" />
          Compliance Overview
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ProgressBar
            label="Training Compliance"
            pct={data.training_compliance_pct}
            colorClass={(data.training_compliance_pct ?? 0) >= 80 ? 'bg-green-500' : 'bg-amber-400'}
          />
          <ProgressBar
            label="Credential Compliance"
            pct={data.credential_compliance_pct}
            colorClass={(data.credential_compliance_pct ?? 0) >= 80 ? 'bg-green-500' : 'bg-amber-400'}
          />
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className={data.overdue_items > 0 ? 'text-red-400' : 'text-green-400'} />
            <div>
              <div className="text-xs text-rmpg-400">Overdue Items</div>
              <div className="text-lg font-bold text-rmpg-100">{data.overdue_items}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
        <h3 className="text-sm font-medium text-rmpg-100 mb-3 flex items-center gap-2">
          <Activity size={14} className="text-rmpg-400" />
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
                  className="flex items-start gap-3 bg-surface-sunken border border-rmpg-700 rounded-sm p-2.5 transition-colors duration-150 hover:border-border-strong"
                >
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{ backgroundColor: activityColor(item.type) }}
                  />
                  <Icon size={14} className="text-rmpg-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-rmpg-100">{item.description}</div>
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

      {/* Disciplinary Log — summary only; capped at DISC_DASHBOARD_LIMIT.
          Full audit trail is in DisciplinaryTab. */}
      <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-rmpg-100 flex items-center gap-2">
            <FileWarning size={14} className="text-rmpg-400" />
            Recent Disciplinary Records
          </h3>
          {onNavigateToDisciplinary && (
            <button
              type="button"
              onClick={onNavigateToDisciplinary}
              className="flex items-center gap-1 text-xs text-rmpg-400 hover:text-rmpg-100 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 rounded-sm"
              aria-label="View all disciplinary records"
            >
              View all
              <ChevronRight size={12} />
            </button>
          )}
        </div>

        {discLoading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 size={14} className="animate-spin text-rmpg-400" />
            <span className="text-xs text-rmpg-500">Loading…</span>
          </div>
        ) : discRecords.length === 0 ? (
          <p className="text-xs text-rmpg-500">No disciplinary records on file</p>
        ) : (
          <>
            <div className="space-y-1">
              {discRecords.map(rec => (
                <div
                  key={rec.id}
                  className="flex items-center gap-3 bg-surface-sunken border border-rmpg-700 rounded-sm px-3 py-2 transition-colors duration-150 hover:border-border-strong"
                >
                  <div
                    className="w-1 self-stretch rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        rec.severity === 'termination' || rec.severity === 'suspension'
                          ? 'var(--sev-critical)'
                          : rec.severity === 'written_warning'
                          ? 'var(--sev-warn)'
                          : 'var(--text-muted)',
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-rmpg-100 truncate">{rec.officer_name}</div>
                    <div className="text-xs text-rmpg-500 truncate">{rec.incident_type}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs text-rmpg-400 capitalize">{rec.status.replace(/_/g, ' ')}</div>
                    <div className="text-xs text-rmpg-500">{formatRelativeTime(rec.created_at)}</div>
                  </div>
                </div>
              ))}
            </div>
            {discRecords.length >= DISC_DASHBOARD_LIMIT && onNavigateToDisciplinary && (
              <button
                type="button"
                onClick={onNavigateToDisciplinary}
                className="mt-2 w-full text-xs text-rmpg-400 hover:text-rmpg-100 py-1.5 border border-rmpg-700 rounded-sm hover:border-border-strong transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50"
                aria-label="View all disciplinary records in full log"
              >
                View full disciplinary log ({DISC_DASHBOARD_LIMIT}+ records)
              </button>
            )}
          </>
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
    // /hr/leave/balances returns an ARRAY (one row per officer; one element for
    // an officer's own view). Reading it as an object gave NaN balances.
    apiFetch<LeaveBalances[]>(`/hr/leave/balances?year=${year}`)
      .then((rows) => setBalances(Array.isArray(rows) ? (rows[0] ?? null) : rows))
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
          <BalanceCard label="Vacation" used={balances.vacation_used} total={balances.vacation_total} colorClass="bg-fg-muted" />
          <BalanceCard label="Sick" used={balances.sick_used} total={balances.sick_total} colorClass="bg-red-500" />
          <BalanceCard label="Personal" used={balances.personal_used} total={balances.personal_total} colorClass="bg-purple-500" />
        </div>
      ) : (
        <div className="bg-surface-base border border-rmpg-700 rounded-sm p-4">
          <p className="text-xs text-rmpg-500">Leave balances not available</p>
        </div>
      )}

      {/* Quick actions */}
      <button type="button"
        onClick={onNavigateToLeave}
        className="flex items-center gap-2 bg-surface-base border border-rmpg-700 rounded-sm px-4 py-3 text-sm text-rmpg-100 hover:border-brand-500 transition-all duration-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50 w-full md:w-auto"
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
  onNavigateToDisciplinary,
}: {
  userRole: string;
  userId: string;
  onNavigateToLeave: () => void;
  onNavigateToDisciplinary?: () => void;
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
        <ManagerDashboard data={data} onNavigateToLeave={onNavigateToLeave} onNavigateToDisciplinary={onNavigateToDisciplinary} />
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
