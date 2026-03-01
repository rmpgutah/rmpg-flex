import React, { useState, useEffect } from 'react';
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

const PIE_COLORS = ['#bc1010', '#d4a017', '#4a90c4', '#a855f7', '#22c55e', '#06b6d4', '#707070', '#ec4899', '#8b5cf6'];

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#bc1010',
  P2: '#d4a017',
  P3: '#4a90c4',
  P4: '#707070',
};

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--surface-base)',
    border: '1px solid #383838',
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
        `${officer.full_name},${officer.badge_number},${officer.calls_responded},${officer.incidents_written},${officer.total_hours.toFixed(1)}`
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

export default function ReportsPage() {
  const isMobile = useIsMobile();
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

        setDashboardData(dashboard);
        setIncidentsData(incidents);
        setResponseTimesData(responseTimes);
        setOfficerActivity(officers);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load reports data');
        console.error('Error fetching reports:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchAllData();
  }, [dateRange, customStartDate, customEndDate]);

  // Compute stats
  const stats = {
    totalCalls: incidentsData?.total || 0,
    incidentsFiled: incidentsData?.total || 0,
    avgResponse: responseTimesData?.overall.avgTotalResponseMinutes
      ? `${responseTimesData.overall.avgTotalResponseMinutes.toFixed(1)}m`
      : '0.0m',
    slaMet: responseTimesData?.overall.totalCalls
      ? `${Math.round((responseTimesData.dailyTrend.reduce((acc, d) => acc + (d.avg_response_minutes <= 5 ? d.count : 0), 0) / responseTimesData.overall.totalCalls) * 100)}%`
      : '0%',
    activeOfficers: dashboardData?.officersOnDuty.length || 0,
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
    avgMinutes: parseFloat(item.avg_response_minutes.toFixed(1)),
    targetMinutes: 5,
  }));

  const officerChartData = officerActivity.map(officer => ({
    name: officer.full_name.split(' ').slice(-1)[0], // Last name only
    calls: officer.calls_responded,
    incidents: officer.incidents_written,
  }));

  const handleExport = () => {
    exportToCSV(incidentsData, officerActivity, stats);
  };

  return (
    <div className={`${isMobile ? 'p-3 space-y-3' : 'p-6 space-y-6'} animate-fade-in overflow-auto`}>
      {/* Portal Header */}
      {!isMobile && (
        <div className="panel-beveled bg-surface-base overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-2.5 relative">
            <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #6e0a0a, #bc1010 30%, #bc1010 70%, #6e0a0a)' }} />
            <RmpgLogo height={64} />
            <div className="flex-1">
              <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: '#d0d0d0' }}>Reports & Analytics</h1>
              <p className="text-[9px] tracking-wide" style={{ color: '#484848' }}>Rocky Mountain Protective Group, LLC</p>
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
                className="input-dark text-xs px-2 py-1 font-mono"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
              <span className="text-rmpg-400 text-[10px] uppercase font-bold tracking-wide">to</span>
              <input
                type="date"
                className="input-dark text-xs px-2 py-1 font-mono"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
            </div>
          )}
        </div>
        <PrintButton />
        <button
          className="toolbar-btn"
          onClick={() => navigate('/reports/custom')}
        >
          <Database className="w-3.5 h-3.5" /> Custom Builder
        </button>
        <button
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
          <Loader2 className="w-8 h-8 text-brand-400 animate-spin" />
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
                        {incidentsChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip {...CHART_TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div className={`${isMobile ? 'mt-2' : 'mt-2 flex-1'} space-y-1.5`}>
                    {incidentsChartData.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2">
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#383838" />
                  <XAxis dataKey="priority" tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#a0a0a0', fontSize: 12 }} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#383838" />
                  <XAxis dataKey="date" tick={{ fill: '#a0a0a0', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#a0a0a0', fontSize: 12 }} domain={[0, 'auto']} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#a0a0a0', fontSize: '11px' }} />
                  <Line type="monotone" dataKey="avgMinutes" name="Avg Response" stroke="#bc1010" strokeWidth={2} dot={{ fill: '#bc1010', r: 3 }} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#383838" />
                  <XAxis type="number" tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#a0a0a0', fontSize: 11 }} width={70} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#a0a0a0', fontSize: '11px' }} />
                  <Bar dataKey="calls" name="Calls" fill="#bc1010" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="incidents" name="Incidents" fill="#d4a017" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Call Volume Trend (Area Chart) */}
          {responseTimesData && responseTimesData.dailyTrend.length > 1 && (
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#383838" />
                  <XAxis dataKey="date" tick={{ fill: '#a0a0a0', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#a0a0a0', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Area type="monotone" dataKey="calls" name="Calls" stroke="#3b82f6" strokeWidth={2} fill="url(#callVolumeGradient)" />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Response Time by Priority (Grouped Bar) */}
          {responseTimesData && responseTimesData.byPriority.length > 0 && (
            <div className="bg-surface-base panel-beveled hover:border-rmpg-600 transition-all duration-150">
              <div className="px-4 pt-3 pb-1 border-b border-rmpg-700/50 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider">Response Time by Priority (minutes)</h3>
              </div>
              <div className="p-4">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={responseTimesData.byPriority.map(item => ({
                  priority: item.priority,
                  avgMinutes: parseFloat(item.avg_response_minutes.toFixed(1)),
                  count: item.count,
                  fill: PRIORITY_COLORS[item.priority] || '#6b7280',
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#383838" />
                  <XAxis dataKey="priority" tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#a0a0a0', fontSize: 12 }} />
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ color: '#a0a0a0', fontSize: '11px' }} />
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
        </>
      )}
    </div>
  );
}

// ── Patrol Tracking Report Card ──────────────────────────
function PatrolTrackingCard() {
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
      .catch(() => {});
  }, []);

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
    } catch (err: any) {
      alert(err?.message || 'Failed to generate patrol tracking report');
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
        <div className="flex items-center gap-1 bg-rmpg-800 rounded p-0.5">
          <button
            onClick={() => setMode('hours')}
            className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${mode === 'hours' ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`}
          >
            Quick
          </button>
          <button
            onClick={() => setMode('range')}
            className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase ${mode === 'range' ? 'bg-brand-500/20 text-brand-400' : 'text-rmpg-500 hover:text-rmpg-300'}`}
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
              onChange={e => setHours(parseInt(e.target.value))}
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
                className="input-dark text-[10px] w-28 px-1.5 py-0.5"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-rmpg-400 font-bold uppercase">End:</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="input-dark text-[10px] w-28 px-1.5 py-0.5"
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

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="toolbar-btn-primary text-[10px] px-4 py-1.5 flex items-center gap-1.5 ml-auto"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
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
