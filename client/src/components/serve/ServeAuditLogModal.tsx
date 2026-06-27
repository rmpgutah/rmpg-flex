import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface AuditEntry {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string | null;
  created_at: string;
  user_name: string | null;
}

interface ServeAuditLogModalProps {
  jobId: number;
  onClose: () => void;
}

export default function ServeAuditLogModal({ jobId, onClose }: ServeAuditLogModalProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAudit = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<AuditEntry[]>(`/serve/${jobId}/audit`);
      setEntries(data ?? []);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface-base rounded panel-beveled shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Audit log">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700/40">
          <h2 className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wider">Audit Log — Job #{jobId}</h2>
          <button type="button" onClick={onClose}
            className="p-1 rounded-[2px] text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised transition-colors"
            aria-label="Close audit log">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loading ? (
            <div className="text-[11px] text-rmpg-400 text-center py-8">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-[11px] text-rmpg-400 text-center py-8">No audit entries found</div>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="bg-surface-raised rounded px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold text-rmpg-200 uppercase">{e.action}</span>
                  <span className="text-[9px] text-rmpg-400 font-mono shrink-0">
                    {e.created_at ? new Date(e.created_at + 'Z').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' }) : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {e.user_name && <span className="text-[9px] text-rmpg-400">{e.user_name}</span>}
                  <span className="text-[9px] text-rmpg-500">{e.entity_type}{e.entity_id != null ? ` #${e.entity_id}` : ''}</span>
                </div>
                {e.details && (
                  <pre className="text-[9px] text-rmpg-400 mt-1 whitespace-pre-wrap font-mono leading-tight">
                    {(() => {
                      try { return JSON.stringify(JSON.parse(e.details), null, 1); }
                      catch { return e.details; }
                    })()}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
