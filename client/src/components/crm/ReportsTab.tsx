// ============================================================
// RMPG Flex — CRM Overwatch: Reports Tab
// Revenue, pipeline, retention, and lead source ROI dashboards
// Pure CSS/SVG charts (no chart library)
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
  Download,
  ChevronUp,
  ChevronDown,
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

interface ClientRevenueRow {
  client_id: number;
  client_name: string;
  invoiced: number;
  paid: number;
}

interface RevenueResponse {
  months: RevenueRow[];
  by_client: ClientRevenueRow[];
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

type SortField = 'source' | 'total' | 'won' | 'lost' | 'conversion_rate' | 'total_won_value';
type SortDir = 'asc' | 'desc';

// ── Stage colors ──────────────────────────────────────────
const STAGE_COLORS: Record<PipelineStage, string> = {
  new: '#3b82f6',
  contacted: '#8b5cf6',
  qualified: '#d4a017',
  proposal: '#f59e0b',
  negotiation: '#f97316',
  won: '#22c55e',
  lost: '#ef4444',
  dismissed: '#6b7280',
};

// Ordered funnel stages (top → bottom)
const FUNNEL_STAGES: PipelineStage[] = ['new', 'qualified', 'proposal', 'negotiation', 'won'];

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

function toDisplayLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── CSV Download Helper ────────────────────────────────────
function downloadCsv(filename: string, rows: Record<string, unknown>[], headers: string[]) {
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const val = r[h] ?? '';
      const str = String(val);
      // Escape values that contain commas, quotes, or newlines
      return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV Export Button ──────────────────────────────────────
function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-rmpg-400 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 hover:text-white transition-colors"
    >
      <Download className="w-3 h-3" />
      CSV
    </button>
  );
}

// ════════════════════════════════════════════════════════
// REPORTS TAB
// ════════════════════════════════════════════════════════
export default function ReportsTab() {
  const { addToast } = useToast();

  const [metrics, setMetrics] = useState<CrmMetrics | null>(null);
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [byClient, setByClient] = useState<ClientRevenueRow[]>([]);
  const [pipeline, setPipeline] = useState<PipelineSummary[]>([]);
  const [retention, setRetention] = useState<RetentionRow[]>([]);
  const [leadSourceROI, setLeadSourceROI] = useState<LeadSourceROI[]>([]);
  const [loading, setLoading] = useState(true);

  // ROI table sort state
  const [roiSortField, setRoiSortField] = useState<SortField>('conversion_rate');
  const [roiSortDir, setRoiSortDir] = useState<SortDir>('desc');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [m, rev, pip, ret, roi] = await Promise.all([
        apiFetch<CrmMetrics>('/api/crm/reports/metrics'),
        apiFetch<RevenueResponse | RevenueRow[]>('/api/crm/reports/revenue'),
        apiFetch<{ stages: PipelineSummary[] } | PipelineSummary[]>('/api/crm/reports/pipeline'),
        apiFetch<RetentionRow[]>('/api/crm/reports/retention'),
        apiFetch<LeadSourceROI[]>('/api/crm/reports/lead-source-roi'),
      ]);
      if (m) setMetrics(m);
      if (rev) {
        // Handle both old array shape and new { months, by_client } shape
        if (Array.isArray(rev)) {
          setRevenue(rev);
          setByClient([]);
        } else {
          setRevenue((rev as RevenueResponse).months || []);
          setByClient((rev as RevenueResponse).by_client || []);
        }
      }
      if (pip) setPipeline(Array.isArray(pip) ? pip : (pip as { stages: PipelineSummary[] }).stages || []);
      if (ret) setRetention(ret);
      if (roi) setLeadSourceROI(roi);
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
  const maxClientRevenue = byClient.length > 0 ? Math.max(...byClient.map(c => c.invoiced), 1) : 1;
  const pipelineTotal = pipeline.reduce((s, p) => s + p.count, 0);
  const maxRetention = retention.length > 0 ? Math.max(...retention.map(r => Math.max(r.active, r.inactive)), 1) : 1;

  // Build funnel data: only FUNNEL_STAGES, in order
  const funnelData = FUNNEL_STAGES.map(stage => {
    const found = pipeline.find(p => p.stage === stage);
    return { stage, count: found?.count || 0, total_value: found?.total_value || 0 };
  });

  // Sorted ROI rows
  const sortedROI = [...leadSourceROI].sort((a, b) => {
    const av = a[roiSortField] as number | string;
    const bv = b[roiSortField] as number | string;
    if (typeof av === 'string') {
      return roiSortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    }
    return roiSortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  function toggleSort(field: SortField) {
    if (roiSortField === field) {
      setRoiSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setRoiSortField(field);
      setRoiSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (roiSortField !== field) return <ChevronDown className="w-2.5 h-2.5 opacity-30" />;
    return roiSortDir === 'asc'
      ? <ChevronUp className="w-2.5 h-2.5 text-brand-400" />
      : <ChevronDown className="w-2.5 h-2.5 text-brand-400" />;
  }

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
            color="text-cyan-400"
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
      {/* 2. REVENUE BY CLIENT BAR CHART (SVG)           */}
      {/* ═══════════════════════════════════════════════ */}
      {byClient.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" /> Revenue by Client (Top 10)
            </div>
            <CsvButton onClick={() => downloadCsv('revenue-by-client.csv', byClient as unknown as Record<string, unknown>[], ['client_name', 'invoiced', 'paid'])} />
          </div>
          <div className="flex items-center gap-3 mb-2 text-[10px]">
            <div className="flex items-center gap-1"><span className="w-3 h-2 inline-block" style={{ backgroundColor: '#1a5a9e' }} /> Invoiced</div>
            <div className="flex items-center gap-1"><span className="w-3 h-2 inline-block bg-green-500" /> Paid</div>
          </div>
          {/* SVG horizontal bar chart */}
          {(() => {
            const BAR_H = 18;
            const GAP = 5;
            const LABEL_W = 120;
            const VALUE_W = 68;
            const BAR_AREA = 340;
            const totalH = byClient.length * (BAR_H * 2 + GAP + 4) + 4;
            return (
              <svg
                viewBox={`0 0 ${LABEL_W + BAR_AREA + VALUE_W} ${totalH}`}
                width="100%"
                style={{ display: 'block' }}
              >
                {byClient.map((client, i) => {
                  const y = i * (BAR_H * 2 + GAP + 4) + 2;
                  const invW = Math.max((client.invoiced / maxClientRevenue) * BAR_AREA, client.invoiced > 0 ? 2 : 0);
                  const paidW = Math.max((client.paid / maxClientRevenue) * BAR_AREA, client.paid > 0 ? 2 : 0);
                  const name = client.client_name || `Client ${client.client_id}`;
                  // Truncate name if too long
                  const displayName = name.length > 16 ? name.slice(0, 15) + '…' : name;
                  return (
                    <g key={client.client_id}>
                      {/* Client name */}
                      <text
                        x={LABEL_W - 4}
                        y={y + BAR_H - 4}
                        textAnchor="end"
                        fontSize={9}
                        fill="#9ca3af"
                        fontFamily="monospace"
                      >
                        {displayName}
                      </text>
                      {/* Invoiced bar */}
                      <rect x={LABEL_W} y={y} width={invW} height={BAR_H} fill="#1a5a9e" rx={1} />
                      {/* Paid overlay bar */}
                      <rect x={LABEL_W} y={y} width={paidW} height={BAR_H} fill="#22c55e" opacity={0.55} rx={1} />
                      {/* Invoiced value */}
                      <text
                        x={LABEL_W + BAR_AREA + 4}
                        y={y + BAR_H - 4}
                        fontSize={9}
                        fill="#9ca3af"
                        fontFamily="monospace"
                      >
                        {formatCurrency(client.invoiced)}
                      </text>
                      {/* Paid sub-bar label */}
                      <text
                        x={LABEL_W + BAR_AREA + 4}
                        y={y + BAR_H * 2 - 2}
                        fontSize={8}
                        fill="#22c55e"
                        fontFamily="monospace"
                      >
                        {formatCurrency(client.paid)}
                      </text>
                      {/* Paid bar (second row visual indicator) */}
                      <rect x={LABEL_W} y={y + BAR_H + 2} width={paidW} height={BAR_H - 4} fill="#22c55e" opacity={0.35} rx={1} />
                    </g>
                  );
                })}
              </svg>
            );
          })()}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* 3. MONTHLY REVENUE CHART                       */}
      {/* ═══════════════════════════════════════════════ */}
      {revenue.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" /> Monthly Revenue
            </div>
            <CsvButton onClick={() => downloadCsv('monthly-revenue.csv', revenue as unknown as Record<string, unknown>[], ['month', 'invoiced', 'paid'])} />
          </div>
          <div className="flex items-center gap-3 mb-2 text-[10px]">
            <div className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 rounded-sm" /> Invoiced</div>
            <div className="flex items-center gap-1"><span className="w-3 h-2 bg-green-500 rounded-sm" /> Paid</div>
          </div>
          <div className="space-y-1.5">
            {revenue.map(row => (
              <div key={row.month} className="flex items-center gap-2">
                <div className="w-16 text-[10px] text-rmpg-400 text-right font-mono shrink-0">{row.month}</div>
                <div className="flex-1 space-y-0.5">
                  <div className="flex items-center gap-1">
                    <div className="h-3 bg-blue-500/70 rounded-sm transition-all" style={{ width: `${(row.invoiced / maxRevenue) * 100}%`, minWidth: row.invoiced > 0 ? '2px' : 0 }} />
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
      {/* 4. PIPELINE FUNNEL WITH CONVERSION RATES       */}
      {/* ═══════════════════════════════════════════════ */}
      {pipeline.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
              <PieChart className="w-3.5 h-3.5" /> Pipeline Funnel
            </div>
            <CsvButton onClick={() => downloadCsv('pipeline-funnel.csv', pipeline as unknown as Record<string, unknown>[], ['stage', 'count', 'total_value'])} />
          </div>

          {/* Vertical funnel with tapering CSS shapes + conversion rates */}
          <div className="flex gap-4">
            {/* Funnel visualization */}
            <div className="flex flex-col items-center gap-0 flex-1 max-w-xs">
              {funnelData.map((item, idx) => {
                const maxCount = Math.max(...funnelData.map(f => f.count), 1);
                // Funnel shape: top stage is widest (100%), each subsequent narrows
                const widthPct = Math.max(30, Math.round((item.count / maxCount) * 100));
                // Conversion rate to next stage
                const nextItem = funnelData[idx + 1];
                const convRate = (item.count > 0 && nextItem)
                  ? ((nextItem.count / item.count) * 100).toFixed(0)
                  : null;

                return (
                  <React.Fragment key={item.stage}>
                    {/* Stage block */}
                    <div
                      className="flex items-center justify-between px-3 py-1.5 text-[10px] font-semibold text-white transition-all"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: STAGE_COLORS[item.stage],
                        borderRadius: '2px',
                        minHeight: '28px',
                      }}
                      title={`${toDisplayLabel(item.stage)}: ${item.count} leads • ${formatCurrency(item.total_value)}`}
                    >
                      <span>{toDisplayLabel(item.stage)}</span>
                      <span className="font-mono ml-2">{item.count}</span>
                    </div>
                    {/* Conversion rate connector */}
                    {convRate !== null && (
                      <div className="flex flex-col items-center my-0.5 text-[9px] text-rmpg-400">
                        <div className="w-px h-2 bg-rmpg-600" />
                        <span className="px-1.5 py-0.5 bg-rmpg-800 border border-rmpg-700 rounded-sm font-mono text-amber-400">
                          → {convRate}%
                        </span>
                        <div className="w-px h-2 bg-rmpg-600" />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Stage details table */}
            <div className="flex-1">
              <div className="space-y-1">
                {funnelData.filter(f => f.count > 0).map(item => (
                  <div key={item.stage} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 shrink-0"
                      style={{ backgroundColor: STAGE_COLORS[item.stage], borderRadius: '2px' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-rmpg-400">{toDisplayLabel(item.stage)}</div>
                      <div className="text-xs text-white font-mono">
                        {item.count}
                        <span className="text-rmpg-500 ml-1">{formatCurrency(item.total_value)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* Also show remaining pipeline stages (contacted, lost etc.) */}
              {pipeline.filter(p => !FUNNEL_STAGES.includes(p.stage)).map(ps => (
                <div key={ps.stage} className="flex items-center gap-2 mt-1">
                  <span
                    className="w-2.5 h-2.5 shrink-0"
                    style={{ backgroundColor: STAGE_COLORS[ps.stage], borderRadius: '2px' }}
                  />
                  <div>
                    <div className="text-[10px] text-rmpg-400">{toDisplayLabel(ps.stage)}</div>
                    <div className="text-xs text-white font-mono">{ps.count} <span className="text-rmpg-500">({formatCurrency(ps.total_value)})</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stacked bar (overall breakdown) */}
          <div className="flex h-6 rounded-sm overflow-hidden border border-rmpg-700 mt-3">
            {pipeline.map(ps => {
              const pct = pipelineTotal > 0 ? (ps.count / pipelineTotal) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={ps.stage}
                  className="flex items-center justify-center text-[10px] font-bold text-white/90 transition-all"
                  style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[ps.stage], minWidth: pct > 0 ? '28px' : 0 }}
                  title={`${toDisplayLabel(ps.stage)}: ${ps.count} leads`}
                >
                  {ps.count}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* 5. LEAD SOURCE ROI TABLE (SORTABLE)            */}
      {/* ═══════════════════════════════════════════════ */}
      {leadSourceROI.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
              <Target className="w-3.5 h-3.5" /> Lead Source ROI
            </div>
            <CsvButton onClick={() => downloadCsv('lead-source-roi.csv', leadSourceROI as unknown as Record<string, unknown>[], ['source', 'total', 'won', 'lost', 'conversion_rate', 'total_won_value'])} />
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-rmpg-700">
                {(
                  [
                    { field: 'source' as SortField, label: 'Source', align: 'left' },
                    { field: 'total' as SortField, label: 'Leads', align: 'right' },
                    { field: 'won' as SortField, label: 'Won', align: 'right' },
                    { field: 'lost' as SortField, label: 'Lost', align: 'right' },
                    { field: 'conversion_rate' as SortField, label: 'Conv. Rate', align: 'right' },
                    { field: 'total_won_value' as SortField, label: 'Total Closed', align: 'right' },
                  ] as { field: SortField; label: string; align: string }[]
                ).map(col => (
                  <th
                    key={col.field}
                    className={`text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 cursor-pointer hover:text-white select-none ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    onClick={() => toggleSort(col.field)}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      <SortIcon field={col.field} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedROI.map(row => (
                <tr key={row.source} className="border-b border-rmpg-700/30 hover:bg-[#1a2636]">
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
      {/* 6. CLIENT RETENTION                            */}
      {/* ═══════════════════════════════════════════════ */}
      {retention.length > 0 && (
        <div className="panel-beveled p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> Client Retention
            </div>
            <CsvButton onClick={() => downloadCsv('client-retention.csv', retention as unknown as Record<string, unknown>[], ['month', 'active', 'inactive'])} />
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
