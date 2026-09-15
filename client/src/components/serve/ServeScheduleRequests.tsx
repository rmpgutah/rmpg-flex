// Subject "schedule a delivery" requests (migration 0279) — rendered inside
// ServeJobCard. The request came from a member of the public via
// rmpgutahps.us/notice-of-attempt, so the copy stays neutral and the only
// actions are accept / decline. Accepting can stamp next_attempt_note so the
// next printed Notice reflects the agreed window.
import { useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToastSafe } from '../ToastProvider';
import { safeDateStr, safeTimeStr } from '../../utils/dateUtils';
import type { ServeScheduleRequest } from '../../types';

const WINDOW_LABEL: Record<ServeScheduleRequest['preferred_window'], string> = {
  morning: 'Morning (before noon)',
  afternoon: 'Afternoon (12–5 PM)',
  evening: 'Evening (after 5 PM)',
  weekend: 'Weekend',
};

interface Props {
  requests: ServeScheduleRequest[];
  /** Called after a request is resolved so the parent can refetch the job. */
  onResolved?: () => void;
}

export default function ServeScheduleRequests({ requests, onResolved }: Props) {
  const toast = useToastSafe();
  const [busyId, setBusyId] = useState<number | null>(null);
  const pending = requests.filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;

  const resolve = async (r: ServeScheduleRequest, status: 'accepted' | 'declined') => {
    setBusyId(r.id);
    try {
      await apiFetch(`/serve/schedule-requests/${r.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, set_next_attempt_note: status === 'accepted' }),
      });
      toast?.addToast(status === 'accepted' ? 'Delivery request accepted' : 'Delivery request declined', 'success');
      onResolved?.();
    } catch (err) {
      toast?.addToast(err instanceof Error ? err.message : 'Could not update request', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="serve-schedule-requests">
      <span className="text-[9px] font-bold text-[color:var(--field-label-color)] uppercase tracking-wider flex items-center gap-1">
        <CalendarClock className="w-3 h-3" aria-hidden="true" />
        Subject Requested Delivery ({pending.length})
      </span>
      <div className="mt-1 space-y-1">
        {pending.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-2 pl-2 py-1 border-l-2 border-sev-warn/60 bg-surface-raised/40"
          >
            <div className="flex-1 min-w-0 text-[10px] leading-tight">
              <div className="text-rmpg-100 font-semibold">{WINDOW_LABEL[r.preferred_window]}</div>
              <div className="text-fg-secondary truncate">
                {r.contact_method === 'phone' ? 'Call ' : 'Email '}
                <span className="font-mono">{r.contact_value}</span>
                <span className="text-fg-muted"> · {safeDateStr(r.created_at)} {safeTimeStr(r.created_at)}</span>
              </div>
              {r.note && <div className="text-fg-muted italic truncate" title={r.note}>“{r.note}”</div>}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                aria-label={`Accept ${WINDOW_LABEL[r.preferred_window]} delivery request`}
                disabled={busyId === r.id}
                onClick={(e) => { e.stopPropagation(); void resolve(r, 'accepted'); }}
                className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-sev-ok/20 text-sev-ok border border-sev-ok/40 rounded-[2px] hover:bg-sev-ok/30 disabled:opacity-50"
              >
                <Check className="w-3 h-3 inline -mt-px" aria-hidden="true" /> Accept
              </button>
              <button
                type="button"
                aria-label={`Decline ${WINDOW_LABEL[r.preferred_window]} delivery request`}
                disabled={busyId === r.id}
                onClick={(e) => { e.stopPropagation(); void resolve(r, 'declined'); }}
                className="px-1.5 py-0.5 text-[9px] font-bold uppercase bg-surface-sunken text-fg-secondary border border-rmpg-600/50 rounded-[2px] hover:bg-surface-raised disabled:opacity-50"
              >
                <X className="w-3 h-3 inline -mt-px" aria-hidden="true" /> Decline
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
