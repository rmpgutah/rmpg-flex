import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useSoftphone } from './SoftphoneProvider';

// The provider owns the single SSE connection; this just renders its latest
// duress alert until dismissed.
export default function DuressBanner() {
  const { lastDuress } = useSoftphone();
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useEffect(() => { if (lastDuress) setDismissedAt(null); }, [lastDuress]);
  if (!lastDuress || dismissedAt === lastDuress.at) return null;
  return (
    <div
      className="fixed top-0 inset-x-0 z-[9999] flex items-center gap-2 px-3 py-2 text-[12px] font-bold uppercase tracking-wide"
      style={{ background: 'var(--sev-critical)', color: 'var(--text-primary)' }}
      role="alert"
    >
      {/* `at` is an epoch-ms number captured client-side, not a server string. */}
      <AlertTriangle className="w-4 h-4" /> Duress alert: {lastDuress.name} · {new Date(lastDuress.at).toLocaleTimeString() /* new-date-ok */}
      <button type="button" aria-label="Dismiss duress alert" className="ml-auto" onClick={() => setDismissedAt(lastDuress.at)}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
