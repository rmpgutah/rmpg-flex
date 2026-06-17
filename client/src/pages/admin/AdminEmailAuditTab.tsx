// Admin UI for the outbound-email audit log.
// Reads /api/email/audit (role-gated to admin/manager/supervisor).

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface AuditRow {
  id: number;
  sent_by: number | null;
  sent_by_username: string | null;
  to_addresses: string;   // JSON array
  cc_addresses: string | null;
  subject: string;
  template_id: number | null;
  graph_message_id: string | null;
  status: 'sent' | 'failed';
  error: string | null;
  sent_at: string;
}

function parseAddresses(json: string | null): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
}

export default function AdminEmailAuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'sent' | 'failed'>('all');

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const data = await apiFetch<AuditRow[]>(`/email/audit${qs}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch audit log:', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAudit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-rmpg-100">Outbound Email Audit</h3>
        <div className="flex gap-1 ml-2">
          {(['all', 'sent', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded-sm ${
                filter === f
                  ? 'bg-[#d4a017] text-black font-semibold'
                  : 'bg-[#141414] text-rmpg-400 hover:text-rmpg-100 border border-[#222]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={fetchAudit}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[#141414] text-rmpg-300 border border-[#222] hover:text-rmpg-100 rounded-sm"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-400 p-4">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading audit log…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-[10px] text-rmpg-500 p-4 text-center bg-[#050505] border border-[#1a1a1a]">
          No audit rows yet. Send an email to see it logged here.
        </div>
      ) : (
        <div className="border border-[#222] overflow-hidden">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-[#141414] text-rmpg-400 text-[9px] uppercase tracking-wide">
                <th className="text-left font-semibold py-[3px] px-2">When</th>
                <th className="text-left font-semibold py-[3px] px-2">Sender</th>
                <th className="text-left font-semibold py-[3px] px-2">To</th>
                <th className="text-left font-semibold py-[3px] px-2">Subject</th>
                <th className="text-left font-semibold py-[3px] px-2">Status</th>
                <th className="text-left font-semibold py-[3px] px-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const to = parseAddresses(r.to_addresses);
                return (
                  <tr key={r.id} className="border-t border-[#1a1a1a] hover:bg-[#0c0c0c]">
                    <td className="py-[2px] px-2 text-rmpg-300 font-mono whitespace-nowrap">
                      {r.sent_at.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-[2px] px-2 text-rmpg-100">{r.sent_by_username || '—'}</td>
                    <td className="py-[2px] px-2 text-rmpg-300 truncate max-w-[200px]" title={to.join(', ')}>
                      {to.slice(0, 2).join(', ')}{to.length > 2 ? ` +${to.length - 2}` : ''}
                    </td>
                    <td className="py-[2px] px-2 text-gray-200 truncate max-w-[260px]" title={r.subject}>
                      {r.subject || '(no subject)'}
                    </td>
                    <td className="py-[2px] px-2">
                      {r.status === 'sent' ? (
                        <span className="flex items-center gap-1 text-green-400">
                          <CheckCircle2 className="w-3 h-3" /> sent
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-400">
                          <XCircle className="w-3 h-3" /> failed
                        </span>
                      )}
                    </td>
                    <td className="py-[2px] px-2 text-red-300 truncate max-w-[280px]" title={r.error || ''}>
                      {r.error || ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[9px] text-rmpg-500">
        Last 200 rows. Records sender, recipients, subject, and outcome of every <code>/api/email/send</code> call.
      </p>
    </div>
  );
}
