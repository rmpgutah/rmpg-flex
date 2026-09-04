// client/src/components/serve/AttemptTimelineModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { parseTimestamp } from '../../utils/dateUtils';
import { formatEnumValue } from '../../utils/formatters';

interface TimelineEntry {
  type: 'attempt' | 'activity';
  timestamp: string;
  data: any;
}
interface AttemptTimelineResponse {
  queue_id: number;
  queue: any;
  total_attempts: number;
  total_activities: number;
  timeline: TimelineEntry[];
}

interface AttemptTimelineModalProps {
  queueId: number;
  onClose: () => void;
}

export default function AttemptTimelineModal({ queueId, onClose }: AttemptTimelineModalProps) {
  const [data, setData] = useState<AttemptTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<AttemptTimelineResponse>(`/serve-dashboard/attempt-timeline/${queueId}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  }, [queueId]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface-base rounded panel-beveled shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Attempt timeline"
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-rmpg-700/40">
          <h2 className="text-[11px] font-bold text-rmpg-100 uppercase tracking-wider">
            Timeline — {data?.queue?.recipient_name ?? `Job #${queueId}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[2px] text-rmpg-400 hover:text-rmpg-200 hover:bg-surface-raised transition-colors"
            aria-label="Close timeline"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <div className="text-[11px] text-fg-muted text-center py-6">Loading…</div>}
          {error && <div className="text-[11px] text-red-400 text-center py-6">{error}</div>}
          {!loading && !error && data && data.timeline.length === 0 && (
            <div className="text-[11px] text-fg-muted text-center py-6">No activity recorded for this job.</div>
          )}
          {!loading && !error && data?.timeline.map((entry, i) => (
            <div key={`${entry.type}-${entry.timestamp}-${entry.data?.id ?? i}`} className="border-b border-rmpg-800 last:border-0 pb-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-fg-muted tabular-nums">
                  {parseTimestamp(entry.timestamp)?.toLocaleString() ?? entry.timestamp}
                </span>
                <span className={`text-[8px] uppercase font-semibold px-1.5 py-0.5 rounded-[2px] ${
                  entry.type === 'attempt' ? 'bg-brand-900/50 text-brand-400' : 'bg-rmpg-800 text-rmpg-400'
                }`}>
                  {formatEnumValue(entry.type)}
                </span>
              </div>
              {entry.type === 'attempt' ? (
                <div className="text-[10px] text-rmpg-200 mt-1">
                  Attempt #{entry.data.attempt_number} by {entry.data.officer_name ?? 'Unknown'} — result: {entry.data.result}
                  {entry.data.notes && <div className="text-rmpg-400 mt-0.5">{entry.data.notes}</div>}
                </div>
              ) : (
                <div className="text-[10px] text-rmpg-200 mt-1">
                  {entry.data.action} by {entry.data.user_name ?? 'System'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
