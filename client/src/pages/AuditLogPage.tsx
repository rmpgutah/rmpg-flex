import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ScrollText,
  Search,
  Filter,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Loader2,
  Clock,
  X
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import { localToday } from '../utils/dateUtils';

interface AuditLogEntry {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  ip_address: string;
  created_at: string;
  user_name: string;
  badge_number: string;
  user_role: string;
}

interface AuditStats {
  totalEntries: number;
  entriesToday: number;
  topActions: Array<{ action: string; count: string }>;
  topUsers: Array<{ user_name: string; badge_number: string; count: string }>;
}

interface Filters {
  action: string;
  entityType: string;
  userId: string;
  startDate: string;
  endDate: string;
  search: string;
}

const AuditLogPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(100);

  const [filters, setFilters] = useState<Filters>({
    action: '',
    entityType: '',
    userId: '',
    startDate: '',
    endDate: '',
    search: ''
  });

  // Memoized filter dropdown values — derived from logs, recalculated only when logs change
  const uniqueActions = useMemo(() => {
    const actions = new Set<string>();
    logs.forEach((log) => {
      if (log.action) actions.add(log.action);
    });
    return Array.from(actions).sort();
  }, [logs]);

  const uniqueEntityTypes = useMemo(() => {
    const entityTypes = new Set<string>();
    logs.forEach((log) => {
      if (log.entity_type) entityTypes.add(log.entity_type);
    });
    return Array.from(entityTypes).sort();
  }, [logs]);

  const uniqueUsers = useMemo(() => {
    const usersMap = new Map<number, { name: string; badge: string }>();
    logs.forEach((log) => {
      if (log.user_id && log.user_name) {
        usersMap.set(log.user_id, { name: log.user_name, badge: log.badge_number });
      }
    });
    return Array.from(usersMap.entries())
      .map(([id, user]) => ({ id, name: user.name, badge: user.badge }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);

  // Fetch logs
  const fetchLogs = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString()
      });

      if (filters.action) queryParams.append('action', filters.action);
      if (filters.entityType) queryParams.append('entityType', filters.entityType);
      if (filters.userId) queryParams.append('userId', filters.userId);
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);
      if (filters.search) queryParams.append('search', filters.search);

      const data = await apiFetch<{ data: AuditLogEntry[]; pagination: { total: number; totalPages: number } }>(`/audit/logs?${queryParams.toString()}`);

      setLogs(data.data);
      setTotalPages(data.pagination.totalPages);
      setTotal(data.pagination.total);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setError('Failed to load audit logs. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, limit, filters]);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<AuditStats>('/audit/stats');
      setStats(data);
    } catch (err) {
      console.error('Error fetching audit stats:', err);
      setError('Failed to load audit statistics.');
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs(true);
      fetchStats();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchLogs, fetchStats]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (page !== 1) {
      setPage(1);
    } else {
      fetchLogs();
    }
  }, [filters]);

  // Get action color — stable callback, no dependencies
  const getActionColor = useCallback((action: string): string => {
    const actionLower = action.toLowerCase();

    // Green: creates, login success, clock in
    if (actionLower.includes('_created') || actionLower === 'login_success' || actionLower === 'clock_in') {
      return 'text-green-400';
    }

    // Blue: updates, status changes, dispatch
    if (actionLower.includes('_updated') || actionLower === 'status_change' || actionLower === 'unit_dispatched') {
      return 'text-brand-400';
    }

    // Red: deletes, cancellations
    if (actionLower.includes('_deleted') || actionLower.includes('_cancelled') || actionLower === 'bolo_cancelled') {
      return 'text-red-400';
    }

    // Amber: submitted, approved, returned, login failed
    if (actionLower.includes('_submitted') || actionLower.includes('_approved') ||
        actionLower.includes('_returned') || actionLower === 'login_failed') {
      return 'text-amber-400';
    }

    // Gray: everything else
    return 'text-rmpg-300';
  }, []);

  // Format timestamp
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setFilters({
      action: '',
      entityType: '',
      userId: '',
      startDate: '',
      endDate: '',
      search: ''
    });
    setPage(1);
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = ['Timestamp', 'User', 'Badge', 'Action', 'Entity Type', 'Entity ID', 'Details', 'IP Address'];
    const csvData = logs.map(log => [
      formatTimestamp(log.created_at),
      log.user_name || 'System',
      log.badge_number || 'N/A',
      log.action,
      log.entity_type,
      log.entity_id,
      log.details,
      log.ip_address || 'N/A'
    ]);

    const csvContent = [
      headers.join(','),
      ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${localToday()}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  // Handle filter changes
  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const hasActiveFilters = useMemo(() => Object.values(filters).some(val => val !== ''), [filters]);

  return (
    <div className="p-6 bg-surface-base min-h-screen text-rmpg-100">
      {/* Portal Header */}
      <div className="panel-beveled bg-surface-base overflow-hidden mb-6">
        <div className="flex items-center gap-4 px-4 py-2.5 relative">
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: 'linear-gradient(90deg, #0f3460, #1a5a9e 30%, #1a5a9e 70%, #0f3460)' }} />
          <RmpgLogo height={64} />
          <div className="flex-1">
            <h1 className="text-sm font-bold tracking-wider uppercase" style={{ color: '#c0d0e0' }}>Audit Log</h1>
            <p className="text-[9px] tracking-wide" style={{ color: '#3a5070' }}>Rocky Mountain Protective Group, LLC</p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="mb-6">
        <PanelTitleBar title="AUDIT TRAIL" icon={ScrollText}>
          <button
            onClick={() => {
              fetchLogs(true);
              fetchStats();
            }}
            disabled={refreshing}
            className="toolbar-btn"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <ExportButton exportUrl="/audit/export?format=csv" exportFilename="audit_log_export.csv" />
          <PrintButton />
          <button
            onClick={exportToCSV}
            disabled={logs.length === 0}
            className="toolbar-btn toolbar-btn-primary"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </PanelTitleBar>

        {/* Stats Row */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="panel-beveled p-3" style={{ background: '#161616' }}>
              <div className="flex items-center gap-2 mb-2">
                <ScrollText className="w-4 h-4 text-brand-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Total Entries</span>
              </div>
              <div className="text-2xl font-bold text-brand-400 font-mono">{stats.totalEntries.toLocaleString()}</div>
            </div>
            <div className="panel-beveled p-3" style={{ background: stats.entriesToday > 0 ? '#0a1a0a' : '#161616' }}>
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-green-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Today</span>
              </div>
              <div className="text-2xl font-bold text-green-400 font-mono">{stats.entriesToday.toLocaleString()}</div>
            </div>
            <div className="panel-beveled p-3" style={{ background: '#161616' }}>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Top Action (30d)</span>
              </div>
              <div className="text-sm font-bold truncate font-mono text-amber-400">
                {stats.topActions[0]?.action || 'N/A'}
              </div>
              <div className="text-[10px] text-rmpg-500 mt-0.5">
                {stats.topActions[0]?.count ? `${stats.topActions[0].count} occurrences` : ''}
              </div>
              {stats.topActions.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-rmpg-700/50 space-y-0.5">
                  {stats.topActions.slice(1, 4).map((a, i) => (
                    <div key={i} className="flex items-center justify-between text-[9px]">
                      <span className="text-rmpg-400 truncate">{a.action}</span>
                      <span className="text-rmpg-500 font-mono ml-2">{a.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="panel-beveled p-3" style={{ background: '#161616' }}>
              <div className="flex items-center gap-2 mb-2">
                <Filter className="w-4 h-4 text-cyan-400" />
                <span className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Top User (30d)</span>
              </div>
              <div className="text-sm font-bold truncate font-mono text-cyan-400">
                {stats.topUsers[0]?.user_name || 'N/A'}
              </div>
              <div className="text-[10px] text-rmpg-500 mt-0.5">
                {stats.topUsers[0]?.count ? `${stats.topUsers[0].count} actions` : ''}
                {stats.topUsers[0]?.badge_number ? ` · Badge #${stats.topUsers[0].badge_number}` : ''}
              </div>
              {stats.topUsers.length > 1 && (
                <div className="mt-1.5 pt-1.5 border-t border-rmpg-700/50 space-y-0.5">
                  {stats.topUsers.slice(1, 4).map((u, i) => (
                    <div key={i} className="flex items-center justify-between text-[9px]">
                      <span className="text-rmpg-400 truncate">{u.user_name}</span>
                      <span className="text-rmpg-500 font-mono ml-2">{u.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="panel-beveled p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-rmpg-300" />
          <span className="text-sm font-semibold">Filters</span>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="ml-auto px-3 py-1 bg-rmpg-700 hover:bg-rmpg-600 text-xs flex items-center gap-1 border border-rmpg-600"
            >
              <X className="w-3 h-3" />
              Clear All
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Action Filter */}
          <div>
            <label className="block text-xs text-rmpg-300 mb-1">Action:</label>
            <select
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
              className="select-dark text-xs"
            >
              <option value="">All Actions</option>
              {uniqueActions.map(action => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>

          {/* Entity Type Filter */}
          <div>
            <label className="block text-xs text-rmpg-300 mb-1">Entity Type:</label>
            <select
              value={filters.entityType}
              onChange={(e) => handleFilterChange('entityType', e.target.value)}
              className="select-dark text-xs"
            >
              <option value="">All Types</option>
              {uniqueEntityTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* User Filter */}
          <div>
            <label className="block text-xs text-rmpg-300 mb-1">User:</label>
            <select
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
              className="select-dark text-xs"
            >
              <option value="">All Users</option>
              {uniqueUsers.map(user => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.badge})
                </option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs text-rmpg-300 mb-1">Start Date:</label>
            <div className="relative">
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange('startDate', e.target.value)}
                className="input-dark text-xs"
              />
              <Calendar className="absolute right-2 top-2.5 w-4 h-4 text-rmpg-400 pointer-events-none" />
            </div>
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs text-rmpg-300 mb-1">End Date:</label>
            <div className="relative">
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange('endDate', e.target.value)}
                className="input-dark text-xs"
              />
              <Calendar className="absolute right-2 top-2.5 w-4 h-4 text-rmpg-400 pointer-events-none" />
            </div>
          </div>

          {/* Search */}
          <div>
            <label className="block text-xs text-rmpg-300 mb-1">Search Details:</label>
            <div className="relative">
              <input
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                placeholder="Search..."
                className="input-dark text-xs pl-8"
              />
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-rmpg-400 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-0 mb-3 px-3 py-2 bg-red-900/40 border border-red-700/50 text-red-300 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Results Summary */}
      <div className="mb-3 text-xs text-rmpg-300">
        Showing {logs.length > 0 ? ((page - 1) * limit + 1) : 0} - {Math.min(page * limit, total)} of {total.toLocaleString()} entries
      </div>

      {/* Table */}
      <div className="panel-beveled overflow-hidden bg-surface-base">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-rmpg-400">
            <ScrollText className="w-12 h-12 mb-3 opacity-50" />
            <p>No audit logs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Badge</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-750">
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-rmpg-400" />
                        {formatTimestamp(log.created_at)}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {log.user_name || <span className="text-rmpg-400 italic">System</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono">
                      {log.badge_number || <span className="text-rmpg-400">-</span>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className={`font-semibold ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <div className="text-rmpg-200">{log.entity_type}</div>
                      <div className="text-rmpg-400 font-mono">{log.entity_id}</div>
                    </td>
                    <td className="px-3 py-1.5 max-w-md">
                      <div className="truncate" title={log.details}>
                        {log.details}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-rmpg-300 font-mono">
                      {log.ip_address || <span className="text-rmpg-500">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-rmpg-300">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-2 bg-rmpg-700 hover:bg-rmpg-600 text-xs flex items-center gap-1 border border-rmpg-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`px-3 py-2 text-xs border ${
                      page === pageNum
                        ? 'bg-brand-600 border-brand-500 text-white'
                        : 'bg-rmpg-700 hover:bg-rmpg-600 border-rmpg-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-2 bg-rmpg-700 hover:bg-rmpg-600 text-xs flex items-center gap-1 border border-rmpg-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLogPage;
