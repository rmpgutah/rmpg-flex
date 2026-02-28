import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Calendar,
  Download,
  Loader2,
  TrendingUp,
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
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';

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
      return { startDate: today.toISOString().split('T')[0] };

    case 'last_7_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 7);
      return { startDate: date.toISOString().split('T')[0] };
    }

    case 'last_14_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 14);
      return { startDate: date.toISOString().split('T')[0] };
    }

    case 'last_30_days': {
      const date = new Date(today);
      date.setDate(date.getDate() - 30);
      return { startDate: date.toISOString().split('T')[0] };
    }

    case 'this_month': {
      const date = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: date.toISOString().split('T')[0] };
    }

    case 'last_month': {
      const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      };
    }

    case 'this_quarter': {
      const quarter = Math.floor(today.getMonth() / 3);
      const date = new Date(today.getFullYear(), quarter * 3, 1);
      return { startDate: date.toISOString().split('T')[0] };
    }

    default:
      return { startDate: today.toISOString().split('T')[0] };
  }
}

function formatGroupKey(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
  link.setAttribute('download', `rmpg-reports-${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ============================================================
// Main Component
// ============================================================

export default function ReportsPage() {
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
    <div className="p-6 space-y-6 animate-fade-in overflow-auto">
      {/* Portal Header */}
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

      {/* Header */}
      <PanelTitleBar title="REPORTS & ANALYTICS" icon={BarChart3}>
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
          onClick={handleExport}
          disabled={loading || !incidentsData}
        >
          <Download className="w-3.5 h-3.5" /> Export
        </button>
      </PanelTitleBar>

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
          <div className="grid grid-cols-5 gap-4">
            <div className="bg-surface-base panel-beveled p-4 text-center hover:bg-surface-raised transition-all duration-150">
              <p className="text-2xl font-bold text-green-400 font-mono">{stats.totalCalls}</p>
              <p className="text-[10px] text-rmpg-300 uppercase mt-1 font-bold tracking-wide">Total Calls</p>
            </div>
            <div className="bg-surface-base panel-beveled p-4 text-center hover:bg-surface-raised transition-all duration-150">
              <p className="text-2xl font-bold text-green-400 font-mono">{stats.incidentsFiled}</p>
              <p className="text-[10px] text-rmpg-300 uppercase mt-1 font-bold tracking-wide">Incidents Filed</p>
            </div>
            <div className="bg-surface-base panel-beveled p-4 text-center hover:bg-surface-raised transition-all duration-150">
              <p className="text-2xl font-bold text-green-400 font-mono">{stats.avgResponse}</p>
              <p className="text-[10px] text-rmpg-300 uppercase mt-1 font-bold tracking-wide">Avg Response</p>
            </div>
            <div className="bg-surface-base panel-beveled p-4 text-center hover:bg-surface-raised transition-all duration-150">
              <p className="text-2xl font-bold text-green-400 font-mono">{stats.slaMet}</p>
              <p className="text-[10px] text-rmpg-300 uppercase mt-1 font-bold tracking-wide">SLA Met</p>
            </div>
            <div className="bg-surface-base panel-beveled p-4 text-center hover:bg-surface-raised transition-all duration-150">
              <p className="text-2xl font-bold text-green-400 font-mono">{stats.activeOfficers}</p>
              <p className="text-[10px] text-rmpg-300 uppercase mt-1 font-bold tracking-wide">Active Officers</p>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-2 gap-6">
            {/* Incidents by Type (Pie) */}
            <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-4">Incidents by Type</h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={incidentsChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {incidentsChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip {...CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Calls by Priority (Bar) */}
            <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-4">Calls by Priority</h3>
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

            {/* Response Times Trend (Line) */}
            <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-4">Response Time Trend (minutes)</h3>
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

            {/* Officer Activity (Bar) */}
            <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-4">Officer Activity Comparison</h3>
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

          {/* Call Volume Trend (Area Chart) */}
          {responseTimesData && responseTimesData.dailyTrend.length > 1 && (
            <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
                Call Volume Trend
              </h3>
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
          )}

          {/* Response Time by Priority (Grouped Bar) */}
          {responseTimesData && responseTimesData.byPriority.length > 0 && (
            <div className="bg-surface-base panel-beveled p-4 hover:border-rmpg-600 transition-all duration-150">
              <h3 className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-4">Response Time by Priority (minutes)</h3>
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
          )}
        </>
      )}
    </div>
  );
}
