import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Calendar,
  Download,
  Loader2,
  TrendingUp,
  Database,
  MapPin,
  FileText,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import { apiFetch } from '../hooks/useApi';
import { useIsMobile } from '../hooks/useIsMobile';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import { useToast } from '../components/ToastProvider';
import { localToday, dateToLocalYMD } from '../utils/dateUtils';
import { generatePatrolTrackingPdf } from '../utils/patrolTrackingPdfGenerator';
import { formatIncidentType } from '../utils/caseNumbers';
import { toDisplayLabel } from '../utils/formatters';

// ============================================================
// Types
// ============================================================

interface DashboardData {
  activeCalls: number;
  todayCalls: number;
  unitsOnDuty: number;
  totalUnits: number;
  pendingReports: number;
  activeBolos: number;
  avgResponseMinutes: number;
  callsByPriority: Array<{ priority: string; count: number }>;
  callsByStatus: Array<{ status: string; count: number }>;
  recentActivity: any[];
  officersOnDuty: any[];
  callsByHour: any[];
}

interface IncidentsSummaryData {
  groupBy: string;
  data: Array<{ group_key: string; count: number }>;
  total: number;
}

interface ResponseTimesData {
  overall: {
    avgDispatchMinutes: number;
    avgTotalResponseMinutes: number;
    minResponseMinutes: number;
    maxResponseMinutes: number;
    totalCalls: number;
  };
  byPriority: Array<{ priority: string; avg_response_minutes: number; count: number }>;
  dailyTrend: Array<{ date: string; avg_response_minutes: number; count: number }>;
}

interface OfficerActivityData {
  officer_id: number;
  full_name: string;
  badge_number: string;
  incidents_written: number;
  calls_responded: number;
  total_hours: number;
}

// ============================================================
// Constants
// ============================================================

const PIE_COLORS = ['#1a5a9e', '#d4a017', '#4a90c4', '#a855f7', '#22c55e', '#06b6d4', '#5a6e80', '#ec4899', '#8b5cf6'];

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#dc2626',
  P2: '#d4a017',
  P3: '#4a90c4',
  P4: '#5a6e80',
};

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--surface-base)',
    border: '1px solid #2a3e58',
    borderRadius: '0px',
    color: '#e0e0e0',
    fontSize: '11px',
    fontFamily: 'monospace',
  },
};

// ============================================================
// Helper Functions
// ============================================================

function getDateRange(range: string): { startDate: string; endDate?: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (range) {
    case 'today':
      return { startDate: dateToLocalYMD(today) };

    case 'last_7_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 7);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'last_14_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 14);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'last_30_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 30);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'this_month': {
      const date = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: dateToLocalYMD(date) };
    }

    case 'last_month': {
      const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startDate: dateToLocalYMD(startDate),
        endDate: dateToLocalYMD(endDate),
      };
    }

    case 'this_quarter': {
      const quarter = Math.floor(today.getMonth() / 3);
      const date = new Date(today.getFullYear(), quarter * 3, 1);
      return { startDate: dateToLocalYMD(date) };
    }

    default:
      return { startDate: dateToLocalYMD(today) };
  }
}

function formatGroupKey(key: string): string {
  // Use formatIncidentType first (it knows official labels), fall back to toDisplayLabel
  const typed = formatIncidentType(key);
  return typed !== key ? typed : toDisplayLabel(key);
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function convertToCSV(data: any[], headers: string[]): string {
  const rows = [headers.join(',')];

  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' && value.includes(',')) {
        return `"${value}"`;
      }
      return value;
    });
    rows.push(values.join(','));
  });

  return rows.join('\n');
}

function exportToCSV(
  incidentsData: IncidentsSummaryData | null,
  officerActivity: OfficerActivityData[],
  stats: {
    totalCalls: number;
    incidentsFiled: number;
    avgResponse: string;
    slaMet: string;
    activeOfficers: number;
  }
) {
  const sections: string[] = [];

  // Summary section
  sections.push('SUMMARY STATISTICS');
  sections.push('Metric,Value');
  sections.push(`Total Calls,${stats.totalCalls}`);
  sections.push(`Incidents Filed,${stats.incidentsFiled}`);
  sections.push(`Avg Response Time,${stats.avgResponse}`);
  sections.push(`SLA Met,${stats.slaMet}`);
  sections.push(`Active Officers,${stats.activeOfficers}`);
  sections.push('');

  // Incidents by type
  if (incidentsData) {
    sections.push('INCIDENTS BY TYPE');
    sections.push('Type,Count');
    incidentsData.data.forEach(item => {
      sections.push(`${formatGroupKey(item.group_key)},${item.count}`);
    });
    sections.push('');
  }

  // Officer activity
  if (officerActivity.length > 0) {
    sections.push('OFFICER ACTIVITY');
    sections.push('Officer Name,Badge Number,Calls Responded,Incidents Written,Total Hours');
    officerActivity.forEach(officer => {
      sections.push(
        `${officer.full_name},${officer.badge_number},${officer.calls_responded},${officer.incidents_written},${(Number(officer.total_hours) || 0).toFixed(1)}`
      );
    });
  }

  const csv = sections.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `rmpg-reports-${localToday()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ============================================================
// Main Component
// ============================================================

// ═══════════════════════════════════════════════════════════
// Feature 27: Report Approval Queue Component
// ═══════════════════════════════════════════════════════════
function ReportApprovalQueue() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    try {
      const data = await apiFetch<any[]>('/records/reports/approval-queue');
      setReports(Array.isArray(data) ? data : []);
    } catch { setReports([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const handleApprove = async (id: string) => {
    setProcessing(id);
    try {
      await apiFetch(`/records/reports/${id}/approve`, { method: 'POST' });
      setReports(prev => prev.filter(r => String(r.id) !== id));
    } catch { /* ignore */ }
    finally { setProcessing(null); }
  };

  const handleReturn = async (id: string) => {
    const reason = prompt('Return reason:');
    if (!reason) return;
    setProcessing(id);
    try {
      await apiFetch(`/records/reports/${id}/return`, { method: 'POST', body: JSON.stringify({ reason }) });
      setReports(prev => prev.filter(r => String(r.id) !== id));
    } catch { /* ignore */ }
    finally { setProcessing(null); }
  };

  if (loading) return <div className="flex items-center gap-2 text-[10px] text-rmpg-500"><Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> Loading queue...</div>;
  if (reports.length === 0) return <div className="text-[10px] text-rmpg-500 text-center py-4">No reports pending review</div>;

  return (
    <div className="space-y-2">
      {reports.map((r: any) => (
        <div key={r.id} className="panel-beveled p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-green-400 font-mono">{r.incident_number}</span>
              <span className="text-[10px] text-rmpg-300">{formatIncidentType(r.incident_type)}</span>
              <span className="px-1 py-0 text-[8px] font-bold bg-purple-900/40 text-purple-400 border border-purple-700/50">PENDING REVIEW</span>
            </div>
            <div className="text-[9px] text-rmpg-400 mt-0.5">
              {r.officer_name && <span>{r.officer_name}</span>}
              {r.badge_number && <span className="ml-1">#{r.badge_number}</span>}
              <span className="ml-2">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
            </div>
            {r.narrative && <div className="text-[9px] text-rmpg-500 mt-0.5 truncate max-w-[300px]">{r.narrative.slice(0, 100)}</div>}
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button type="button"
              onClick={() => handleApprove(String(r.id))}
              disabled={processing === String(r.id)}
              className="toolbar-btn text-[9px] bg-green-900/30 text-green-400 border-green-700/30 hover:bg-green-800/40"
            >
              Approve
            </button>
            <button type="button"
              onClick={() => handleReturn(String(r.id))}
              disabled={processing === String(r.id)}
              className="toolbar-btn text-[9px] bg-red-900/30 text-red-400 border-red-700/30 hover:bg-red-800/40"
            >
              Return
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 11: Daily Briefing Generator Component
// ═══════════════════════════════════════════════════════════════
function DailyBriefingCard() {
  const [briefing, setBriefing] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadBriefing = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>('/reports/daily-briefing');
      setBriefing(data);
      setExpanded(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-green-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Daily Shift Briefing</h3>
        </div>
        <button type="button" onClick={loadBriefing} disabled={loading} className="toolbar-btn text-[9px]">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : 'Generate'}
        </button>
      </div>
      {expanded && briefing && (
        <div className="p-4 space-y-3 text-xs">
          <div>
            <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-1.5">Previous Day Stats</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-brand-400">{briefing.prevDayStats?.total_calls || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Calls</div>
              </div>
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-red-400">{briefing.prevDayStats?.p1_calls || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">P1 Calls</div>
              </div>
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-amber-400">{briefing.prevDayStats?.p2_calls || 0}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">P2 Calls</div>
              </div>
              <div className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono text-blue-400">{briefing.prevDayStats?.avg_response || 'N/A'}m</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Avg Response</div>
              </div>
            </div>
          </div>
          {briefing.activeBolos?.length > 0 && (
            <div>
              <div className="text-[9px] text-red-400 uppercase font-bold tracking-wider mb-1">Active BOLOs ({briefing.activeBolos.length})</div>
              {briefing.activeBolos.slice(0, 5).map((b: any) => (
                <div key={b.id} className="text-[10px] text-rmpg-300 py-0.5">
                  <span className="text-red-400 font-mono mr-1">{b.bolo_number}</span> {b.title}
                </div>
              ))}
            </div>
          )}
          {briefing.activeWarrants?.length > 0 && (
            <div>
              <div className="text-[9px] text-amber-400 uppercase font-bold tracking-wider mb-1">Active Warrants ({briefing.activeWarrants.length})</div>
              {briefing.activeWarrants.slice(0, 5).map((w: any) => (
                <div key={w.id} className="text-[10px] text-rmpg-300 py-0.5">
                  <span className="text-amber-400 font-mono mr-1">{w.warrant_number}</span> {w.charge_description}
                </div>
              ))}
            </div>
          )}
          {briefing.trendingIncidents?.length > 0 && (
            <div>
              <div className="text-[9px] text-brand-400 uppercase font-bold tracking-wider mb-1">Trending (7-day)</div>
              {briefing.trendingIncidents.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-rmpg-300 py-0.5">
                  <span>{formatIncidentType(t.incident_type)}</span>
                  <span className="font-mono font-bold">{t.count}</span>
                </div>
              ))}
            </div>
          )}
          {briefing.personnelOnDuty?.length > 0 && (
            <div>
              <div className="text-[9px] text-green-400 uppercase font-bold tracking-wider mb-1">Personnel On Duty ({briefing.personnelOnDuty.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {briefing.personnelOnDuty.map((p: any, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 bg-green-900/20 border border-green-700/30 text-[9px] text-green-400 font-mono">{p.call_sign} ({p.full_name})</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 12: Weekly Activity Digest Component
// ═══════════════════════════════════════════════════════════════
function WeeklyDigestCard() {
  const [digest, setDigest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadDigest = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<any>('/reports/weekly-digest');
      setDigest(data);
      setExpanded(true);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Weekly Activity Digest</h3>
        </div>
        <button type="button" onClick={loadDigest} disabled={loading} className="toolbar-btn text-[9px]">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : 'Generate'}
        </button>
      </div>
      {expanded && digest && (
        <div className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-5 gap-2">
            {[
              { label: 'Calls', value: digest.summary?.totalCalls || 0, color: '#3b82f6' },
              { label: 'Incidents', value: digest.summary?.totalIncidents || 0, color: '#22c55e' },
              { label: 'Citations', value: digest.summary?.totalCitations || 0, color: '#f59e0b' },
              { label: 'Arrests', value: digest.summary?.totalArrests || 0, color: '#ef4444' },
              { label: 'Avg Response', value: digest.summary?.avgResponseMinutes ? `${digest.summary.avgResponseMinutes}m` : 'N/A', color: '#1a5a9e' },
            ].map(s => (
              <div key={s.label} className="panel-beveled bg-surface-sunken p-2 text-center">
                <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">{s.label}</div>
              </div>
            ))}
          </div>
          {digest.byDay?.length > 0 && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-1.5">Daily Breakdown</div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={digest.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
                  <XAxis dataKey="day" tick={{ fill: '#8a9aaa', fontSize: 9 }} tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-US', { weekday: 'short' })} />
                  <YAxis tick={{ fill: '#8a9aaa', fontSize: 9 }} allowDecimals={false} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" fill="#1a5a9e" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {digest.topIncidentTypes?.length > 0 && (
            <div>
              <div className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider mb-1">Top Incident Types</div>
              {digest.topIncidentTypes.slice(0, 5).map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-rmpg-300 py-0.5">
                  <span>{formatIncidentType(t.incident_type)}</span>
                  <span className="font-mono font-bold">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Features 3, 7, 8, 9, 10: Specialized Report Cards
// ═══════════════════════════════════════════════════════════════
function CrimeTrendCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await apiFetch<any>('/reports/crime-trends')); } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="bg-surface-base panel-beveled p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" /> <span className="text-xs text-rmpg-400">Loading crime trends...</span></div>;
  if (!data) return null;

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <TrendingUp className="w-3.5 h-3.5 text-red-400" />
        <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Crime Trend Analysis</h3>
      </div>
      <div className="p-4 space-y-3">
        {data.monthlyTrend?.length > 0 && (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={data.monthlyTrend}>
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
              <XAxis dataKey="month" tick={{ fill: '#8a9aaa', fontSize: 9 }} />
              <YAxis tick={{ fill: '#8a9aaa', fontSize: 9 }} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} fill="url(#trendGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {data.trends?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 z-10 bg-[#0d1520]">
                <tr className="border-b border-rmpg-600">
                  <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">Type</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Current</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Prev Month</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">MoM %</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Last Year</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">YoY %</th>
                </tr>
              </thead>
              <tbody>
                {data.trends.slice(0, 10).map((t: any) => (
                  <tr key={t.type} className="border-b border-rmpg-700/50 hover:bg-surface-raised transition-colors">
                    <td className="px-2 py-1.5 text-rmpg-200">{formatIncidentType(t.type)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{t.current}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-400">{t.previous}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-bold ${t.momChange > 0 ? 'text-red-400' : t.momChange < 0 ? 'text-green-400' : 'text-rmpg-400'}`}>
                      {t.momChange > 0 ? '+' : ''}{t.momChange}%
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-400">{t.lastYear}</td>
                    <td className={`px-2 py-1.5 text-right font-mono font-bold ${t.yoyChange > 0 ? 'text-red-400' : t.yoyChange < 0 ? 'text-green-400' : 'text-rmpg-400'}`}>
                      {t.yoyChange > 0 ? '+' : ''}{t.yoyChange}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CitationRevenueCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>('/reports/citation-revenue').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="bg-surface-base panel-beveled p-4 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-brand-400" role="status" aria-label="Loading" /> <span className="text-xs text-rmpg-400">Loading citation revenue...</span></div>;
  if (!data) return null;

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <Database className="w-3.5 h-3.5 text-green-400" />
        <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Citation Revenue Report</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Total Fines', value: `$${(data.summary?.total_fines || 0).toLocaleString()}`, color: '#3b82f6' },
            { label: 'Collected', value: `$${(data.summary?.collected || 0).toLocaleString()}`, color: '#22c55e' },
            { label: 'Outstanding', value: `$${(data.summary?.outstanding || 0).toLocaleString()}`, color: '#f59e0b' },
            { label: 'Dismissed', value: `$${(data.summary?.dismissed || 0).toLocaleString()}`, color: '#ef4444' },
          ].map(s => (
            <div key={s.label} className="panel-beveled bg-surface-sunken p-2 text-center">
              <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[8px] text-rmpg-500 uppercase">{s.label}</div>
            </div>
          ))}
        </div>
        {data.monthlyRevenue?.length > 0 && (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.monthlyRevenue}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
              <XAxis dataKey="month" tick={{ fill: '#8a9aaa', fontSize: 9 }} />
              <YAxis tick={{ fill: '#8a9aaa', fontSize: 9 }} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ color: '#8a9aaa', fontSize: '9px' }} />
              <Bar dataKey="collected" name="Collected" fill="#22c55e" radius={[2, 2, 0, 0]} />
              <Bar dataKey="outstanding" name="Outstanding" fill="#f59e0b" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function BeatActivityCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<any>('/reports/beat-activity').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading || !data) return null;

  return (
    <div className="bg-surface-base panel-beveled">
      <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
        <MapPin className="w-3.5 h-3.5 text-cyan-400" />
        <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Beat Activity Report</h3>
      </div>
      <div className="p-4">
        {data.beats?.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 z-10 bg-[#0d1520]">
                <tr className="border-b border-rmpg-600">
                  <th className="px-2 py-1.5 text-left text-rmpg-400 font-bold uppercase">Beat</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Calls</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Incidents</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Citations</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Arrests</th>
                  <th className="px-2 py-1.5 text-right text-rmpg-400 font-bold uppercase">Avg Resp</th>
                </tr>
              </thead>
              <tbody>
                {data.beats.map((b: any) => (
                  <tr key={b.beat} className="border-b border-rmpg-700/50 hover:bg-surface-raised transition-colors">
                    <td className="px-2 py-1.5 text-rmpg-200 font-mono font-bold">{b.beat}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-blue-400">{b.calls}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{b.incidents}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{b.citations}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-rmpg-200">{b.arrests}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-brand-400">{b.avg_response_min ? `${b.avg_response_min}m` : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="text-xs text-rmpg-500 text-center py-4">No beat activity data available</div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Feature 14 & 15: Report Scheduling + Templates UI
// ═══════════════════════════════════════════════════════════════
function ReportSchedulesCard() {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiFetch<any[]>('/reports/schedules').catch(() => []),
      apiFetch<any[]>('/reports/templates').catch(() => []),
    ]).then(([s, t]) => {
      setSchedules(Array.isArray(s) ? s : []);
      setTemplates(Array.isArray(t) ? t : []);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-surface-base panel-beveled">
        <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-amber-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Scheduled Reports ({schedules.length})</h3>
        </div>
        <div className="p-3">
          {schedules.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 text-center py-4">No scheduled reports configured</div>
          ) : (
            <div className="space-y-1.5">
              {schedules.map((s: any) => (
                <div key={s.id} className="flex items-center gap-2 panel-beveled bg-surface-sunken p-2">
                  <span className={`led-dot ${s.is_active ? 'led-green' : 'led-off'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-rmpg-200 font-bold truncate">{s.name}</div>
                    <div className="text-[9px] text-rmpg-500">{s.frequency} &middot; {s.report_type}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="bg-surface-base panel-beveled">
        <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-purple-400" />
          <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Report Templates ({templates.length})</h3>
        </div>
        <div className="p-3">
          {templates.length === 0 ? (
            <div className="text-[10px] text-rmpg-500 text-center py-4">No report templates saved</div>
          ) : (
            <div className="space-y-1.5">
              {templates.map((t: any) => (
                <div key={t.id} className="flex items-center gap-2 panel-beveled bg-surface-sunken p-2">
                  <FileText className="w-3 h-3 text-purple-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-rmpg-200 font-bold truncate">{t.name}</div>
                    <div className="text-[9px] text-rmpg-500">{t.report_type}{t.description ? ` - ${t.description}` : ''}</div>
                  </div>
                  {t.is_default ? <span className="text-[8px] text-green-400 font-bold uppercase">Default</span> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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

export default function ReportsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState('last_14_days');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State for all API data
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [incidentsData, setIncidentsData] = useState<IncidentsSummaryData | null>(null);
  const [responseTimesData, setResponseTimesData] = useState<ResponseTimesData | null>(null);
  const [officerActivity, setOfficerActivity] = useState<OfficerActivityData[]>([]);

  // Fetch all data
  useEffect(() => {
    let cancelled = false;

    async function fetchAllData() {
      setLoading(true);
      setError(null);

      try {
        let startDate: string;
        let endDate: string | undefined;
        if (dateRange === 'custom' && customStartDate) {
          startDate = customStartDate;
          endDate = customEndDate || undefined;
        } else {
          const range = getDateRange(dateRange);
          startDate = range.startDate;
          endDate = range.endDate;
        }
        const dateParams = new URLSearchParams({ startDate });
        if (endDate) dateParams.append('endDate', endDate);

        // Fetch all endpoints in parallel
        const [dashboard, incidents, responseTimes, officers] = await Promise.all([
          apiFetch<DashboardData>('/reports/dashboard'),
          apiFetch<IncidentsSummaryData>(`/reports/incidents-summary?groupBy=type&${dateParams.toString()}`),
          apiFetch<ResponseTimesData>(`/reports/response-times?${dateParams.toString()}`),
          apiFetch<OfficerActivityData[]>(`/reports/officer-activity?${dateParams.toString()}`),
        ]);

        if (cancelled) return;
        setDashboardData(dashboard);
        setIncidentsData(incidents);
        setResponseTimesData(responseTimes);
        setOfficerActivity(officers);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load reports data');
        addToast('Failed to load reports data', 'error');
        console.error('Error fetching reports:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAllData();
    return () => { cancelled = true; };
  }, [dateRange, customStartDate, customEndDate]);

  // Compute stats
  const stats = {
    totalCalls: incidentsData?.total || 0,
    incidentsFiled: incidentsData?.total || 0,
    avgResponse: responseTimesData?.overall?.avgTotalResponseMinutes
      ? `${responseTimesData.overall.avgTotalResponseMinutes.toFixed(1)}m`
      : '0.0m',
    slaMet: responseTimesData?.overall?.totalCalls
      ? `${Math.round(((responseTimesData.dailyTrend || []).reduce((acc, d) => acc + (d.avg_response_minutes <= 5 ? d.count : 0), 0) / responseTimesData.overall.totalCalls) * 100)}%`
      : '0%',
    activeOfficers: dashboardData?.officersOnDuty?.length || 0,
  };

  // Prepare chart data
  const incidentsChartData = (Array.isArray(incidentsData?.data) ? incidentsData.data : []).map((item, i) => ({
    name: formatGroupKey(item.group_key),
    value: item.count,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }));

  const priorityChartData = (Array.isArray(dashboardData?.callsByPriority) ? dashboardData.callsByPriority : []).map(item => ({
    priority: item.priority,
    count: item.count,
    fill: PRIORITY_COLORS[item.priority] || '#6b7280',
  }));

  const responseTimeChartData = (Array.isArray(responseTimesData?.dailyTrend) ? responseTimesData.dailyTrend : []).map(item => ({
    date: formatDateLabel(item.date),
    avgMinutes: parseFloat((Number(item.avg_response_minutes) || 0).toFixed(1)),
    targetMinutes: 5,
  }));

  const officerChartData = officerActivity.map(officer => ({
    name: (officer.full_name || '').split(' ').slice(-1)[0] || '?', // Last name only
    calls: officer.calls_responded,
    incidents: officer.incidents_written,
  }));

  const handleExport = () => {
    exportToCSV(incidentsData, officerActivity, stats);
  };

  // Set document title
  useEffect(() => { document.title = 'Reports & Analytics \u2014 RMPG Flex'; }, []);

  return (
    <div className={`${isMobile ? 'p-3 space-y-3' : 'p-6 space-y-6'} animate-fade-in overflow-auto`}>
      {/* Portal Header */}
      {!isMobile && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0e3359, #1a5a9e 30%, #1a5a9e 70%, #0e3359)' }} />
            <RmpgLogo height={64} />
            <div className="flex-1">
              <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: '#d0d0d0' }}>Reports & Analytics</h1>
              <p className="text-[9px] tracking-wide" style={{ color: '#3a5070' }}>Rocky Mountain Protective Group, LLC</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      {!isMobile && <PanelTitleBar title="REPORTS & ANALYTICS" icon={BarChart3}>
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-rmpg-300" />
          <select
            className="select-dark text-xs w-44"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            disabled={loading}
          >
            <option value="today">Today</option>
            <option value="last_7_days">Last 7 Days</option>
            <option value="last_14_days">Last 14 Days</option>
            <option value="last_30_days">Last 30 Days</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="this_quarter">This Quarter</option>
            <option value="custom">Custom Range</option>
          </select>
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 ml-1 pl-2 border-l border-rmpg-700">
              <input
                type="date"
                className="input-dark text-xs px-2 py-1 font-mono min-h-[36px]"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
              <span className="text-rmpg-400 text-[10px] uppercase font-bold tracking-wide">to</span>
              <input
                type="date"
                className="input-dark text-xs px-2 py-1 font-mono min-h-[36px]"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
            </div>
          )}
        </div>
        <PrintButton />
        <button type="button"
          className="toolbar-btn"
          onClick={() => navigate('/reports/custom')}
        >
          <Database className="w-3.5 h-3.5" /> Custom Builder
        </button>
        <button type="button"
          className="toolbar-btn"
          onClick={handleExport}
          disabled={loading || !incidentsData}
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </PanelTitleBar>}

      {/* Error Banner */}
      {error && (
        <div className="bg-red-900/40 border border-red-700/50 text-red-300 px-3 py-2 text-xs flex items-center gap-2">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" role="status" aria-label="Loading" />
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className={`grid ${isMobile ? 'grid-cols-2 gap-2' : 'grid-cols-5 gap-3'}`}>
            {[
              { label: 'Total Calls', value: stats.totalCalls, color: '#3b82f6', border: 'border-l-blue-500' },
              { label: 'Incidents Filed', value: stats.incidentsFiled, color: '#22c55e', border: 'border-l-green-500' },
              { label: 'Avg Response', value: stats.avgResponse, color: '#f59e0b', border: 'border-l-amber-500' },
              { label: 'SLA Met', value: stats.slaMet, color: '#8b5cf6', border: 'border-l-purple-500' },
              { label: 'Active Officers', value: stats.activeOfficers, color: '#ef4444', border: 'border-l-red-500' },
            ].map((s) => (
              <div key={s.label} className={`bg-surface-base panel-beveled p-3 border-l-[3px] ${s.border} hover:bg-surface-raised transition-all duration-150`}>
                <p className="text-2xl font-black font-mono" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[9px] text-rmpg-400 uppercase mt-0.5 font-bold tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Feature 27: Report Approval Queue */}
          <div className="panel-beveled p-4 bg-surface-base">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-purple-400" />
              <span className="text-xs font-bold text-white uppercase">Report Approval Queue</span>
            </div>
            <ReportApprovalQueue />
          </div>

          {/* Charts Grid */}
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
            {/* Incidents by Type (Pie) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-brand-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Incidents by Type</h3>
              </div>
              <div className="p-4">
                <div className={isMobile ? '' : 'flex items-start gap-4'}>
                  <ResponsiveContainer width={isMobile ? '100%' : '55%'} height={220}>
                    <PieChart>
                      <Pie
                        data={incidentsChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {incidentsChartData.map((entry) => (
                          <Cell key={entry.name} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip {...CHART_TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div className={`${isMobile ? 'mt-2' : 'mt-2 flex-1'} space-y-1.5`}>
                    {incidentsChartData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: entry.fill }} />
                        <span className="text-[10px] text-rmpg-200 truncate flex-1">{entry.name}</span>
                        <span className="text-[10px] text-rmpg-400 font-mono font-bold">{entry.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Calls by Priority (Bar) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Calls by Priority</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={priorityChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
                  <XAxis dataKey="priority" tick={{ fill: '#8a9aaa', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#8a9aaa', fontSize: 12 }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {priorityChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>

            {/* Response Times Trend (Line) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-red-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Response Time Trend (minutes)</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={responseTimeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
                  <XAxis dataKey="date" tick={{ fill: '#8a9aaa', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8a9aaa', fontSize: 12 }} domain={[0, 'auto']} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#8a9aaa', fontSize: '11px' }} />
                  <Line type="monotone" dataKey="avgMinutes" name="Avg Response" stroke="#1a5a9e" strokeWidth={2} dot={{ fill: '#1a5a9e', r: 3 }} />
                  <Line type="monotone" dataKey="targetMinutes" name="Target" stroke="#d4a017" strokeDasharray="5 5" strokeWidth={1} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              </div>
            </div>

            {/* Officer Activity (Bar) */}
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-green-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Officer Activity Comparison</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={officerChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
                  <XAxis type="number" tick={{ fill: '#8a9aaa', fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#8a9aaa', fontSize: 11 }} width={70} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#8a9aaa', fontSize: '11px' }} />
                  <Bar dataKey="calls" name="Calls" fill="#1a5a9e" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="incidents" name="Incidents" fill="#d4a017" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Call Volume Trend (Area Chart) */}
          {responseTimesData?.dailyTrend && responseTimesData.dailyTrend.length > 1 && (
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Call Volume Trend</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={responseTimesData.dailyTrend.map(item => ({
                  date: formatDateLabel(item.date),
                  calls: item.count,
                }))}>
                  <defs>
                    <linearGradient id="callVolumeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
                  <XAxis dataKey="date" tick={{ fill: '#8a9aaa', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#8a9aaa', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="calls" name="Calls" stroke="#3b82f6" strokeWidth={2} fill="url(#callVolumeGradient)" />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Response Time by Priority (Grouped Bar) */}
          {responseTimesData?.byPriority && responseTimesData.byPriority.length > 0 && (
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Response Time by Priority (minutes)</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={responseTimesData.byPriority.map(item => ({
                  priority: item.priority,
                  avgMinutes: parseFloat((Number(item.avg_response_minutes) || 0).toFixed(1)),
                  count: item.count,
                  fill: PRIORITY_COLORS[item.priority] || '#6b7280',
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3e58" />
                  <XAxis dataKey="priority" tick={{ fill: '#8a9aaa', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#8a9aaa', fontSize: 12 }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#8a9aaa', fontSize: '11px' }} />
                  <Bar dataKey="avgMinutes" name="Avg Response (min)" radius={[4, 4, 0, 0]}>
                    {responseTimesData.byPriority.map((item, i) => (
                      <Cell key={i} fill={PRIORITY_COLORS[item.priority] || '#6b7280'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Patrol Tracking Report Generator ── */}
          <PatrolTrackingCard />

          {/* ═══ Feature 3: Crime Trend Analysis ═══ */}
          <CrimeTrendCard />

          {/* ═══ Feature 4: Beat Activity Report ═══ */}
          <BeatActivityCard />

          {/* ═══ Feature 9: Citation Revenue Report ═══ */}
          <CitationRevenueCard />

          {/* ═══ Feature 11 & 12: Briefing & Digest ═══ */}
          <div className={`grid ${isMobile ? 'grid-cols-1 gap-3' : 'grid-cols-2 gap-4'}`}>
            <DailyBriefingCard />
            <WeeklyDigestCard />
          </div>

          {/* ═══ Feature 14 & 15: Schedules & Templates ═══ */}
          <ReportSchedulesCard />
        </>
      )}
    </div>
  );
}

// ── Patrol Tracking Report Card ──────────────────────────
function PatrolTrackingCard() {
  const { addToast } = useToast();
  const [mode, setMode] = useState<'hours' | 'range'>('hours');
  const [hours, setHours] = useState(8);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<{ id: number; call_sign: string }[]>([]);
  const [generating, setGenerating] = useState(false);
  const [includeGeocode, setIncludeGeocode] = useState(true);
  const [preview, setPreview] = useState<{ totalUnits: number; totalPoints: number; totalMiles: number; totalMinutes: number } | null>(null);

  // Fetch available units
  useEffect(() => {
    apiFetch<any[]>('/dispatch/units')
      .then((res) => {
        if (Array.isArray(res)) {
          setUnits(res.map((u: any) => ({ id: u.id, call_sign: u.call_sign || `Unit ${u.id}` })));
        }
      })
      .catch((err) => { console.warn('[ReportsPage] fetch units failed:', err); addToast('Failed to load units', 'error'); });
  }, [addToast]);

  const handleGenerate = async () => {
    setGenerating(true);
    setPreview(null);
    try {
      const params = new URLSearchParams();
      if (mode === 'range' && startDate && endDate) {
        // Use local timezone offset to avoid UTC drift
        const tzOffset = new Date().getTimezoneOffset();
        const tzSign = tzOffset <= 0 ? '+' : '-';
        const tzHrs = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
        const tzMins = String(Math.abs(tzOffset) % 60).padStart(2, '0');
        const tz = `${tzSign}${tzHrs}:${tzMins}`;
        params.set('startDate', `${startDate}T00:00:00${tz}`);
        params.set('endDate', `${endDate}T23:59:59${tz}`);
      } else {
        params.set('hours', String(hours));
      }
      if (unitId) params.set('unitId', unitId);
      if (includeGeocode) params.set('geocode', 'true');

      const data = await apiFetch<any>(`/reports/patrol-tracking?${params}`);
      if (!data?.trails?.length) {
        alert('No patrol tracking data found for the selected period.');
        return;
      }

      // Show preview stats
      const totalMiles = data.trails.reduce((s: number, t: any) => s + (t.stats?.total_distance_miles || 0), 0);
      const totalMinutes = data.trails.reduce((s: number, t: any) => s + (t.stats?.duration_minutes || 0), 0);
      setPreview({
        totalUnits: data.total_units,
        totalPoints: data.total_points,
        totalMiles: Math.round(totalMiles * 100) / 100,
        totalMinutes,
      });

      await generatePatrolTrackingPdf(data);
      addToast('Patrol tracking report generated successfully', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to generate patrol tracking report', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-brand-400" />
          <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Patrol Tracking Report</h3>
          <span className="text-[8px] text-rmpg-600 font-mono">PS-210</span>
        </div>
      </div>
      <p className="text-[10px] text-rmpg-500 mb-3">
        Generate a detailed GPS breadcrumb report showing patrol routes, speeds, zones, response times, and road locations.
      </p>

      {/* Row 1: Mode toggle + Unit selector */}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-rmpg-800 rounded-sm p-0.5">
          <button type="button"
            onClick={() => setMode('hours')}
            className={`text-[9px] px-2 py-0.5 rounded-sm font-bold uppercase ${mode === 'hours' ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`}
          >
            Quick
          </button>
          <button type="button"
            onClick={() => setMode('range')}
            className={`text-[9px] px-2 py-0.5 rounded-sm font-bold uppercase ${mode === 'range' ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`}
          >
            Date Range
          </button>
        </div>

        {/* Unit selector */}
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-rmpg-400 font-bold uppercase">Unit:</label>
          <select
            value={unitId}
            onChange={e => setUnitId(e.target.value)}
            className="select-dark text-[10px] w-28"
          >
            <option value="">All Units</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>{u.call_sign}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Date controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {mode === 'hours' ? (
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-rmpg-400 font-bold uppercase">Hours:</label>
            <select
              value={hours}
              onChange={e => setHours(parseInt(e.target.value, 10))}
              className="select-dark text-[10px] w-20"
            >
              <option value={4}>4 hrs</option>
              <option value={8}>8 hrs</option>
              <option value={12}>12 hrs</option>
              <option value={24}>24 hrs</option>
            </select>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-rmpg-400 font-bold uppercase">Start:</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="input-dark text-[10px] w-28 px-1.5 py-0.5 min-h-[36px]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-rmpg-400 font-bold uppercase">End:</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="input-dark text-[10px] w-28 px-1.5 py-0.5 min-h-[36px]"
              />
            </div>
          </>
        )}

        <label className="flex items-center gap-1.5 text-[10px] text-rmpg-400 cursor-pointer">
          <input
            type="checkbox"
            checked={includeGeocode}
            onChange={e => setIncludeGeocode(e.target.checked)}
            className="w-3 h-3"
          />
          Include roads
        </label>

        <button type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1.5 ml-auto"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <FileText className="w-3 h-3" />}
          {generating ? 'Generating...' : 'Export PDF'}
        </button>
      </div>

      {/* Preview stats */}
      {preview && (
        <div className="mt-2 flex items-center gap-4 text-[9px] text-rmpg-400 font-mono border-t border-rmpg-800 pt-2">
          <span>Units: <strong className="text-white">{preview.totalUnits}</strong></span>
          <span>Points: <strong className="text-white">{preview.totalPoints}</strong></span>
          <span>Miles: <strong className="text-brand-400">{preview.totalMiles}</strong></span>
          <span>Duration: <strong className="text-white">{preview.totalMinutes} min</strong></span>
        </div>
      )}
    </div>
  );
}
