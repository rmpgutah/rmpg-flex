import React, { useState } from 'react';
import { Clock, Download, Search, Filter } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { localToday } from '../../utils/dateUtils';

// ============================================================
// Types
// ============================================================

export interface AuditEntry {
  id: string;
  user: string;
  action: string;
  details: string;
  timestamp: string;
}

// ============================================================
// Props
// ============================================================

interface AdminAuditTabProps {
  auditLog: AuditEntry[];
  loadingAudit: boolean;
  LoadingSpinner: React.FC;
}

// ============================================================
// Component
// ============================================================

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

export default function AdminAuditTab({
  auditLog,
  loadingAudit,
  LoadingSpinner,
}: AdminAuditTabProps) {
  // Feature 23: Audit log export with date filtering
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (exportDateFrom) params.set('date_from', exportDateFrom);
      if (exportDateTo) params.set('date_to', exportDateTo);
      if (filterAction) params.set('action', filterAction);

      const response = await fetch(`/api/admin/audit/export?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('rmpg_token')}` },
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${localToday()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
    finally { setExporting(false); }
  };

  // Filter displayed entries
  const filteredLog = auditLog.filter(entry => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!entry.user.toLowerCase().includes(q) && !entry.action.toLowerCase().includes(q) && !entry.details.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (filterAction && entry.action !== filterAction) return false;
    return true;
  });

  // Get unique actions for filter dropdown
  const uniqueActions = [...new Set(auditLog.map(e => e.action))].sort();

  if (loadingAudit) {
    return <LoadingSpinner />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Export toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-[#162236] bg-surface-sunken flex-wrap" role="toolbar" aria-label="Audit log filters">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 panel-inset bg-surface-sunken relative">
          <Search className="w-3 h-3 text-rmpg-500 shrink-0" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search logs..." aria-label="Search audit logs"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-white placeholder-rmpg-500 w-[140px] focus-visible:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="text-rmpg-500 hover:text-rmpg-300 transition-colors p-0.5" aria-label="Clear search">
              <Filter className="w-3 h-3" />
            </button>
          )}
        </div>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2.5 py-1.5 outline-none focus:border-brand-500 transition-colors cursor-pointer"
          aria-label="Filter by action type"
        >
          <option value="">All Actions</option>
          {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={exportDateFrom}
            onChange={e => setExportDateFrom(e.target.value)}
            className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1.5 outline-none focus:border-brand-500 transition-colors"
            aria-label="Export from date"
          />
          <span className="text-[9px] text-rmpg-600" aria-hidden="true">to</span>
          <input
            type="date"
            value={exportDateTo}
            onChange={e => setExportDateTo(e.target.value)}
            className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1.5 outline-none focus:border-brand-500 transition-colors"
            aria-label="Export to date"
          />
        </div>
        <button type="button"
          onClick={handleExport}
          disabled={exporting}
          className="toolbar-btn toolbar-btn-primary text-[10px] disabled:opacity-50 flex items-center gap-1.5"
          aria-label="Export audit log to CSV"
        >
          <Download style={{ width: 11, height: 11 }} aria-hidden="true" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
        <span className="text-[9px] text-rmpg-500 ml-auto tabular-nums font-medium">{filteredLog.length} entries</span>
      </div>

      <div className="flex-1 overflow-auto scrollbar-dark">
        <table className="table-dark" aria-label="Audit log entries">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="whitespace-nowrap" scope="col">Timestamp</th>
              <th className="whitespace-nowrap" scope="col">User</th>
              <th className="whitespace-nowrap" scope="col">Action</th>
              <th className="whitespace-nowrap" scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLog.map((entry, idx) => (
              <tr key={entry.id} className={idx % 2 === 0 ? '' : 'bg-rmpg-800/15'}>
                <td className="text-xs text-rmpg-300 font-mono whitespace-nowrap tabular-nums">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-rmpg-400" aria-hidden="true" />
                    {new Date(entry.timestamp).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}
                  </div>
                </td>
                <td className="text-xs font-semibold text-white">{entry.user}</td>
                <td className="text-xs text-brand-400 font-medium">{entry.action}</td>
                <td className="text-xs text-rmpg-300 max-w-[300px] truncate" title={entry.details}>{entry.details}</td>
              </tr>
            ))}
            {filteredLog.length === 0 && !loadingAudit && (
              <tr>
                <td colSpan={4} className="text-center text-rmpg-400 py-16">
                  <div className="flex flex-col items-center gap-2">
                    <Clock className="w-7 h-7 text-rmpg-600" aria-hidden="true" />
                    <span className="text-xs font-medium text-rmpg-500">No audit log entries{searchQuery || filterAction ? ' matching filters' : ''}</span>
                    {(searchQuery || filterAction) && (
                      <span className="text-[9px] text-rmpg-600">Try broadening your search or clearing filters</span>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
