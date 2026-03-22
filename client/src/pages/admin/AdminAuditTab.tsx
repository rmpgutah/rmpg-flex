import React, { useState } from 'react';
import { Clock, Download, Search, Filter } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

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
      a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
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
      {/* Feature 23: Export toolbar */}
      <div className="flex items-center gap-2 p-3 border-b border-rmpg-700 bg-surface-base flex-wrap">
        <div className="flex items-center gap-1 px-2 py-1 panel-inset bg-surface-sunken">
          <Search className="w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-white placeholder-rmpg-500 w-[120px]"
          />
        </div>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1 outline-none"
        >
          <option value="">All Actions</option>
          {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="date"
          value={exportDateFrom}
          onChange={e => setExportDateFrom(e.target.value)}
          className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1 outline-none"
          placeholder="From"
        />
        <input
          type="date"
          value={exportDateTo}
          onChange={e => setExportDateTo(e.target.value)}
          className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-2 py-1 outline-none"
          placeholder="To"
        />
        <button
          onClick={handleExport}
          disabled={exporting}
          className="toolbar-btn toolbar-btn-primary text-[10px]"
          aria-label="Export audit log to CSV"
        >
          <Download style={{ width: 11, height: 11 }} />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
        <span className="text-[9px] text-rmpg-500 ml-auto">{filteredLog.length} entries</span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="table-dark">
          <thead className="sticky top-0 z-10">
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLog.map((entry) => (
              <tr key={entry.id}>
                <td className="text-xs text-rmpg-300 font-mono whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-rmpg-400" />
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
                <td className="text-xs text-brand-400">{entry.action}</td>
                <td className="text-xs text-rmpg-300 max-w-[300px] truncate" title={entry.details}>{entry.details}</td>
              </tr>
            ))}
            {filteredLog.length === 0 && !loadingAudit && (
              <tr>
                <td colSpan={4} className="text-center text-rmpg-400 py-8">
                  No audit log entries{searchQuery || filterAction ? ' matching filters' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
