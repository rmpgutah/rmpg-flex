// ============================================================
// RMPG Flex — CRM Overwatch: Reports Tab
// Revenue, pipeline, retention, and lead source ROI dashboards
// Pure CSS charts (no chart library)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  Clock,
  Target,
  FileText,
  CheckCircle,
  Loader2,
  BarChart3,
  Users,
  PieChart,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import type { PipelineSummary, PipelineStage } from '../../types';

// ── Types ─────────────────────────────────────────────────
interface RevenueRow {
  month: string;
  invoiced: number;
  paid: number;
}

interface RetentionRow {
  month: string;
  active: number;
  inactive: number;
}

interface LeadSourceROI {
  source: string;
  total: number;
  won: number;
  lost: number;
  conversion_rate: number;
  total_won_value: number;
}

interface CrmMetrics {
  total_pipeline_value: number;
  win_rate: number;
  avg_cycle_days: number;
  leads_this_month: number;
  proposals_sent: number;
  proposals_accepted: number;
}

// ── Stage colors ──────────────────────────────────────────
const STAGE_COLORS: Record<PipelineStage, string> = {
  new: '#888888',
  contacted: '#8b5cf6',
  qualified: '#d4a017',
  proposal: '#f59e0b',
  negotiation: '#f97316',
  won: '#22c55e',
  lost: '#ef4444',
  dismissed: '#666666',
};

const SOURCE_LABELS: Record<string, string> = {
  utah_biz: 'Utah Biz',
  construction_permit: 'Construction',
  commercial_re: 'Commercial RE',
  liquor_license: 'DABC Liquor',
  manual: 'Manual',
};

function formatCurrency(val: number | null | undefined): string {
  if (!val) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function toDisplayLabel(s: string | undefined | null): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

// ════════════════════════════════════════════════════════
// REPORTS TAB
// ════════════════════════════════════════════════════════
export default function ReportsTab() {
  const { addToast } = useToast();

  const [metrics, setMetrics] = useState<CrmMetrics | null>(null);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineSummary[]>([]);
  const [retention, setRetention] = useState<RetentionRow[]>([]);
  const [leadSourceROI, setLeadSourceROI] = useState<LeadSourceROI[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [m, rev, pip, ret, roi] = await Promise.all([
        apiFetch<CrmMetrics>('/crm/reports/metrics'),
        apiFetch<RevenueRow[]>('/crm/reports/revenue'),
        apiFetch<{ stages: PipelineSummary[] }>('/crm/reports/pipeline'),
        apiFetch<RetentionRow[]>('/crm/reports/retention'),
        apiFetch<LeadSourceROI[]>('/crm/reports/lead-source-roi'),
      ]);
      if (m) setMetrics(m);
      if (rev) setRevenue(rev);
      if (pip) setPipeline(Array.isArray(pip) ? pip : pip.stages || []);
      if (ret) setRetention(ret);
      if (roi) setLeadSourceROI(roi.sort((a, b) => b.conversion_rate - a.conversion_rate));
    } catch {
      addToast('Failed to load reports', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  // ── Computed values for charts ───────────────────────
  const maxRevenue = revenue.length > 0 ? Math.max(...revenue.map(r => Math.max(r.invoiced, r.paid)), 1) : 1;
  const pipelineTotal = pipeline.reduce((s, p) => s + p.count, 0);
  const maxRetention = retention.length > 0 ? Math.max(...retention.map(r => Math.max(r.active, r.inactive)), 1) : 1;

  return (
    <div className="overflow-y-auto p-3 space-y-4">
      {/* ═══════════════════════════════════════════════ */}
      {/* 1. KEY METRICS                                 */}
      {/* ═══════════════════════════════════════════════ */}
      <div>
        <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          <BarChart3 className="w-3.5 h-3.5" /> Key Metrics
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <MetricCard
            icon={DollarSign}
            label="Pipeline Value"
            value={formatCurrency(metrics?.total_pipeline_value)}
            color="text-green-400"
          />
          <MetricCard
            icon={TrendingUp}
            label="Win Rate"
            value={`${(metrics?.win_rate || 0).toFixed(1)}%`}
            color="text-brand-400"
          />
          <MetricCard
            icon={Clock}
            label="Avg Cycle"
            value={`${metrics?.avg_cycle_days || 0}d`}
            color="text-amber-400"
          />
          <MetricCard
            icon={Target}
            label="Leads This Month"
            value={String(metrics?.leads_this_month || 0)}
            color="text-gray-400"
          />
          <MetricCard
            icon={FileText}
            label="Proposals Sent"
            value={String(metrics?.proposals_sent || 0)}
            color="text-purple-400"
          />
          <MetricCard
            icon={CheckCircle}
            label="Proposals Accepted"
            value={String(metrics?.proposals_accepted || 0)}
            color="text-green-400"
          />
        </div>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* 2. REVENUE CHART                               */}
      {/* ═══════════════════════════════════════════════ */}
      {revenue.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" /> Monthly Revenue
          </div>
          <div className="flex items-center gap-3 mb-2 text-[10px]">
            <div className="flex items-center gap-1"><span className="w-3 h-2 bg-gray-500 rounded-sm" /> Invoiced</div>
            <div className="flex items-center gap-1"><span className="w-3 h-2 bg-green-500 rounded-sm" /> Paid</div>
          </div>
          <div className="space-y-1.5">
            {revenue.map(row => (
              <div key={row.month} className="flex items-center gap-2">
                <div className="w-16 text-[10px] text-rmpg-400 text-right font-mono shrink-0">{row.month}</div>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-1">
                    <div className="h-3 bg-gray-500/70 rounded-sm transition-all" style={{ width: `${(row.invoiced / maxRevenue) * 100}%`, minWidth: row.invoiced > 0 ? '2px' : 0 }} />
                    <span className="text-[10px] text-rmpg-400 font-mono shrink-0">{formatCurrency(row.invoiced)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-3 bg-green-500/70 rounded-sm transition-all" style={{ width: `${(row.paid / maxRevenue) * 100}%`, minWidth: row.paid > 0 ? '2px' : 0 }} />
                    <span className="text-[10px] text-rmpg-400 font-mono shrink-0">{formatCurrency(row.paid)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* 3. PIPELINE FUNNEL                             */}
      {/* ═══════════════════════════════════════════════ */}
      {pipeline.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            <PieChart className="w-3.5 h-3.5" /> Pipeline Funnel
          </div>
          <div className="flex h-8 rounded-sm overflow-hidden border border-rmpg-700 mb-2">
            {pipeline.map(ps => {
              const pct = pipelineTotal > 0 ? (ps.count / pipelineTotal) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={ps.stage}
                  className="flex items-center justify-center text-[10px] font-bold text-white/90 transition-all"
                  style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[ps.stage], minWidth: pct > 0 ? '30px' : 0 }}
                  title={`${toDisplayLabel(ps.stage)}: ${ps.count} leads`}
                >
                  {ps.count}
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {pipeline.map(ps => (
              <div key={ps.stage} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: STAGE_COLORS[ps.stage] }} />
                <div>
                  <div className="text-[10px] text-rmpg-400">{toDisplayLabel(ps.stage)}</div>
                  <div className="text-xs text-white font-mono">{ps.count} <span className="text-rmpg-500">({formatCurrency(ps.total_value)})</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* 4. LEAD SOURCE ROI                             */}
      {/* ═══════════════════════════════════════════════ */}
      {leadSourceROI.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            <Target className="w-3.5 h-3.5" /> Lead Source ROI
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-rmpg-700">
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Source</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Total</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Won</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Lost</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Conv. Rate</th>
                <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Won Value</th>
              </tr>
            </thead>
            <tbody>
              {leadSourceROI.map(row => (
                <tr key={row.source} className="border-b border-rmpg-700/30 hover:bg-[#181818]">
                  <td className="px-2 py-1.5 text-xs text-white">{SOURCE_LABELS[row.source] || toDisplayLabel(row.source)}</td>
                  <td className="px-2 py-1.5 text-xs text-rmpg-300 text-right font-mono">{row.total}</td>
                  <td className="px-2 py-1.5 text-xs text-green-400 text-right font-mono">{row.won}</td>
                  <td className="px-2 py-1.5 text-xs text-red-400 text-right font-mono">{row.lost}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <div className="w-12 h-1.5 bg-rmpg-800 rounded-sm overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-sm" style={{ width: `${Math.min(row.conversion_rate, 100)}%` }} />
                      </div>
                      <span className="text-xs text-rmpg-300 font-mono w-10 text-right">{row.conversion_rate.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-green-400 text-right font-mono">{formatCurrency(row.total_won_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* 5. CLIENT RETENTION                            */}
      {/* ═══════════════════════════════════════════════ */}
      {retention.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-3 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> Client Retention
          </div>
          <div className="flex items-center gap-3 mb-2 text-[10px]">
            <div className="flex items-center gap-1"><span className="w-3 h-2 bg-green-500 rounded-sm" /> Active</div>
            <div className="flex items-center gap-1"><span className="w-3 h-2 bg-red-500/60 rounded-sm" /> Inactive</div>
          </div>
          <div className="space-y-1.5">
            {retention.map(row => (
              <div key={row.month} className="flex items-center gap-2">
                <div className="w-16 text-[10px] text-rmpg-400 text-right font-mono shrink-0">{row.month}</div>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-1">
                    <div className="h-3 bg-green-500/70 rounded-sm transition-all" style={{ width: `${(row.active / maxRetention) * 100}%`, minWidth: row.active > 0 ? '2px' : 0 }} />
                    <span className="text-[10px] text-rmpg-400 font-mono shrink-0">{row.active}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-3 bg-red-500/50 rounded-sm transition-all" style={{ width: `${(row.inactive / maxRetention) * 100}%`, minWidth: row.inactive > 0 ? '2px' : 0 }} />
                    <span className="text-[10px] text-rmpg-400 font-mono shrink-0">{row.inactive}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!metrics && revenue.length === 0 && pipeline.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-rmpg-400 text-sm">
          <BarChart3 className="w-6 h-6 mb-2 opacity-50" />
          No report data available yet
        </div>
      )}
    </div>
  );
}

// ── Stat card sub-component ───────────────────────────────
function MetricCard({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="panel-beveled p-2.5 flex flex-col items-center text-center">
      <Icon className={`w-4 h-4 ${color} mb-1`} />
      <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[10px] text-rmpg-400 uppercase tracking-wider">{label}</div>
    </div>
  );
}
