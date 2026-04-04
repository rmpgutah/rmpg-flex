// ============================================================
// RMPG Flex — Admin Training Compliance Dashboard
// Org-wide training completion rates, overdue items, and
// officer compliance rankings.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { GraduationCap, AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { toDisplayLabel } from '../../utils/formatters';
import { useToast } from '../../components/ToastProvider';

interface OfficerCompliance {
  user_id: number;
  full_name: string;
  badge_number: string;
  role: string;
  completed: number;
  required: number;
  overdue: number;
  next_expiration?: string;
}

interface TrainingStats {
  total_officers: number;
  overall_compliance_rate: number;
  total_overdue: number;
  expiring_soon: number;
  officers: OfficerCompliance[];
  by_category: { category: string; completed: number; required: number }[];
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

export default function AdminTrainingTab({ LoadingSpinner, error, setError }: Props) {
  const { addToast } = useToast();
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      // Fetch training records + requirements and compute compliance
      const [records, users] = await Promise.all([
        apiFetch<any[]>('/admin/training'),
        apiFetch<any[]>('/admin/users'),
      ]);

      const activeUsers = (users || []).filter((u: any) => u.status === 'active' && ['officer', 'supervisor', 'admin', 'manager'].includes(u.role));
      const trainingRecords = records || [];

      // Group records by user
      const userRecords = new Map<number, any[]>();
      for (const r of trainingRecords) {
        const list = userRecords.get(r.user_id) || [];
        list.push(r);
        userRecords.set(r.user_id, list);
      }

      // Compute per-officer compliance
      const categories = ['firearms', 'defensive_tactics', 'first_aid', 'legal_update', 'driving', 'report_writing', 'de_escalation'];
      let totalOverdue = 0;
      let expiringSoon = 0;
      const now = new Date();
      const thirtyDays = new Date(now.getTime() + 30 * 86400000);

      const byCategory: { category: string; completed: number; required: number }[] = categories.map(cat => ({
        category: cat,
        completed: 0,
        required: activeUsers.length,
      }));

      const officers: OfficerCompliance[] = activeUsers.map((u: any) => {
        const recs = userRecords.get(u.id) || [];
        const completedCats = new Set(recs.filter((r: any) => r.status === 'completed').map((r: any) => r.training_type));
        const completed = completedCats.size;
        const overdue = Math.max(0, categories.length - completed);
        totalOverdue += overdue;

        // Check for expiring certifications
        let nextExp: string | undefined;
        for (const r of recs) {
          if (r.expiration_date) {
            const exp = new Date(r.expiration_date);
            if (exp < thirtyDays && exp > now) {
              expiringSoon++;
              if (!nextExp || exp.toISOString() < nextExp) nextExp = r.expiration_date;
            }
          }
        }

        // Update category counts
        for (let i = 0; i < categories.length; i++) {
          if (completedCats.has(categories[i])) byCategory[i].completed++;
        }

        return {
          user_id: u.id,
          full_name: u.full_name,
          badge_number: u.badge_number || '',
          role: u.role,
          completed,
          required: categories.length,
          overdue,
          next_expiration: nextExp,
        };
      });

      // Sort: most overdue first
      officers.sort((a, b) => b.overdue - a.overdue);

      const compliantCount = officers.filter(o => o.overdue === 0).length;
      const complianceRate = activeUsers.length > 0 ? Math.round((compliantCount / activeUsers.length) * 100) : 100;

      setStats({
        total_officers: activeUsers.length,
        overall_compliance_rate: complianceRate,
        total_overdue: totalOverdue,
        expiring_soon: expiringSoon,
        officers,
        by_category: byCategory,
      });
    } catch (err: any) {
      addToast(err.message || 'Failed to load training data', 'error');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useLiveSync('admin', fetchData);

  if (loading) return <LoadingSpinner />;
  if (!stats) return <div className="p-4 text-rmpg-500">No training data available</div>;

  return (
    <div className="p-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="group" aria-label="Training compliance overview">
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-gray-900/30 border border-gray-700/40 shrink-0" aria-hidden="true">
            <GraduationCap style={{ width: 14, height: 14 }} className="text-gray-400" />
          </div>
          <div>
            <div className="text-[18px] font-black text-gray-400 tabular-nums leading-tight">{stats.total_officers}</div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Total Officers</div>
          </div>
        </div>
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center shrink-0" style={{ background: stats.overall_compliance_rate >= 90 ? 'rgba(34,197,94,0.15)' : stats.overall_compliance_rate >= 70 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', border: `1px solid ${stats.overall_compliance_rate >= 90 ? 'rgba(34,197,94,0.3)' : stats.overall_compliance_rate >= 70 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}` }} aria-hidden="true">
            <CheckCircle style={{ width: 14, height: 14 }} className={stats.overall_compliance_rate >= 90 ? 'text-green-400' : stats.overall_compliance_rate >= 70 ? 'text-amber-400' : 'text-red-400'} />
          </div>
          <div>
            <div className="text-[18px] font-black tabular-nums leading-tight" style={{ color: stats.overall_compliance_rate >= 90 ? '#22c55e' : stats.overall_compliance_rate >= 70 ? '#f59e0b' : '#ef4444' }}>
              {stats.overall_compliance_rate}%
            </div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Compliance Rate</div>
          </div>
        </div>
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-red-900/30 border border-red-700/40 shrink-0" aria-hidden="true">
            <AlertTriangle style={{ width: 14, height: 14 }} className="text-red-400" />
          </div>
          <div>
            <div className="text-[18px] font-black text-red-400 tabular-nums leading-tight">{stats.total_overdue}</div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Overdue Items</div>
          </div>
        </div>
        <div className="panel-beveled p-3 flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-900/30 border border-amber-700/40 shrink-0" aria-hidden="true">
            <Clock style={{ width: 14, height: 14 }} className="text-amber-400" />
          </div>
          <div>
            <div className="text-[18px] font-black text-amber-400 tabular-nums leading-tight">{stats.expiring_soon}</div>
            <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Expiring (30d)</div>
          </div>
        </div>
      </div>

      {/* Category Compliance Bars */}
      <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-2 border-b border-[#162236] pb-1.5">
        <GraduationCap style={{ width: 10, height: 10 }} />
        Compliance by Category
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {stats.by_category.map(cat => {
          const pct = cat.required > 0 ? Math.round((cat.completed / cat.required) * 100) : 100;
          const color = pct >= 90 ? '#22c55e' : pct >= 70 ? '#f59e0b' : '#ef4444';
          return (
            <div key={cat.category} className="panel-beveled p-2 flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-white font-semibold capitalize">
                    {cat.category.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[9px] font-mono" style={{ color }}>
                    {pct}% ({cat.completed}/{cat.required})
                  </span>
                </div>
                <div className="h-1.5 bg-rmpg-700 rounded-full overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Officer Table */}
      <div className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-2">
        Officer Training Status
      </div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-rmpg-500 text-[9px] uppercase tracking-wider" style={{ background: '#080808' }}>
            <th className="text-left px-3 py-1.5 font-bold">Officer</th>
            <th className="text-left px-3 py-1.5 font-bold">Badge</th>
            <th className="text-left px-3 py-1.5 font-bold">Role</th>
            <th className="text-center px-3 py-1.5 font-bold">Completed</th>
            <th className="text-center px-3 py-1.5 font-bold">Overdue</th>
            <th className="text-left px-3 py-1.5 font-bold">Status</th>
            <th className="text-left px-3 py-1.5 font-bold">Next Expiration</th>
          </tr>
        </thead>
        <tbody>
          {stats.officers.map(o => {
            const statusColor = o.overdue === 0 ? '#22c55e' : o.overdue <= 2 ? '#f59e0b' : '#ef4444';
            const statusLabel = o.overdue === 0 ? 'COMPLIANT' : `${o.overdue} OVERDUE`;
            return (
              <tr key={o.user_id} className="border-b border-rmpg-800/30 hover:bg-surface-raised/30 transition-colors">
                <td className="px-3 py-2 font-semibold text-white">{o.full_name}</td>
                <td className="px-3 py-2 text-rmpg-400 font-mono">{o.badge_number || '—'}</td>
                <td className="px-3 py-2 text-rmpg-400">{toDisplayLabel(o.role)}</td>
                <td className="px-3 py-2 text-center font-mono text-rmpg-300">{o.completed}/{o.required}</td>
                <td className="px-3 py-2 text-center font-mono" style={{ color: o.overdue > 0 ? '#ef4444' : '#666666' }}>
                  {o.overdue}
                </td>
                <td className="px-3 py-2">
                  <span className="text-[8px] font-bold uppercase px-1.5 py-0.5" style={{ background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}44` }}>
                    {statusLabel}
                  </span>
                </td>
                <td className="px-3 py-2 text-rmpg-400">
                  {o.next_expiration ? new Date(o.next_expiration).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
