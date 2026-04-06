import React from 'react';
import { Clock } from 'lucide-react';

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
  if (loadingAudit) {
    return <LoadingSpinner />;
  }

  return (
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
        {auditLog.map((entry) => (
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
            <td className="text-xs text-rmpg-300">{entry.details}</td>
          </tr>
        ))}
        {auditLog.length === 0 && !loadingAudit && (
          <tr>
            <td colSpan={4} className="text-center text-rmpg-400 py-8">
              No audit log entries
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
