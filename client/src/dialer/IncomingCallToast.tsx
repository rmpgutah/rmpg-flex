import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { PhoneCall, X } from 'lucide-react';
import { useSoftphone } from './SoftphoneProvider';
import { DIALER_CONNECT_PATH } from '../components/dialerConnect';
import { displayPhone } from '../utils/dialerConnect';

export default function IncomingCallToast() {
  const s = useSoftphone();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ringing = s.status === 'incoming' || s.status === 'call_waiting';
  const from = s.status === 'call_waiting' ? s.waitingFrom : s.remoteNumber;
  useEffect(() => { if (!ringing) setDismissed(null); }, [ringing]);
  if (!ringing || dismissed === from) return null;
  return (
    <div
      className="fixed bottom-4 left-4 z-[9998] flex items-center gap-2 px-3 py-2 border shadow-lg text-[11px] font-semibold uppercase tracking-wide max-w-[320px] bg-surface-raised text-rmpg-50"
      style={{ borderColor: 'var(--sev-ok)' }}
      role="status"
    >
      <PhoneCall className="w-3.5 h-3.5 flex-shrink-0" />
      <button type="button" className="truncate text-left" onClick={() => navigate(DIALER_CONNECT_PATH)}>
        Inbound call from {displayPhone(from)}
      </button>
      <button
        type="button"
        aria-label="Answer"
        className="ml-1 px-2 py-0.5 border"
        style={{ color: 'var(--sev-ok)', borderColor: 'var(--sev-ok)' }}
        onClick={() => { s.answer(); navigate(DIALER_CONNECT_PATH); }}
      >
        Answer
      </button>
      <button type="button" aria-label="Dismiss notification" className="ml-auto opacity-70 hover:opacity-100" onClick={() => setDismissed(from)}>
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
