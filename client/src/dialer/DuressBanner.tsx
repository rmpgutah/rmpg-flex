import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useDialerStream } from './useDialerStream';
import { useSoftphone } from './SoftphoneProvider';

export default function DuressBanner() {
  const s = useSoftphone();
  const [alert, setAlert] = useState<{ name: string; at: string } | null>(null);
  const streaming = s.status !== 'passive' && s.status !== 'unlinked' && s.status !== 'offline' && s.status !== 'error';
  useDialerStream((e) => {
    if (e.type === 'duress_alert') {
      setAlert({ name: String((e as { dispatcherName?: string }).dispatcherName ?? 'A dispatcher'), at: new Date().toLocaleTimeString() });
    }
  }, streaming);
  if (!alert) return null;
  return (
    <div
      className="fixed top-0 inset-x-0 z-[9999] flex items-center gap-2 px-3 py-2 text-[12px] font-bold uppercase tracking-wide"
      style={{ background: 'var(--sev-critical)', color: 'var(--text-primary)' }}
      role="alert"
    >
      <AlertTriangle className="w-4 h-4" /> Duress alert: {alert.name} · {alert.at}
      <button type="button" aria-label="Dismiss duress alert" className="ml-auto" onClick={() => setAlert(null)}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
