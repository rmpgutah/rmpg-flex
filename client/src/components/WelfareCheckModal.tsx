// ============================================================
// RMPG Flex — Officer Welfare Check Modal (MDT)
// Full-screen takeover when the server pushes a welfare_check
// event. Officer must explicitly choose: CODE 4 (ack), NEED HELP
// (escalates to emergency broadcast), or SNOOZE 5 MIN (resets
// the activity timer). No tap-outside dismiss.
// ============================================================

import { useEffect, useState, useRef } from 'react';
import { Activity, ShieldAlert, Clock } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../hooks/useApi';

interface WelfarePayload {
  action: string;
  callSign?: string;
  callId?: string | number;
  callNumber?: string;
  message?: string;
}

export default function WelfareCheckModal() {
  const { subscribe } = useWebSocket();
  const { user } = useAuth();
  const [active, setActive] = useState<WelfarePayload | null>(null);
  const [submitting, setSubmitting] = useState<null | 'ack' | 'help' | 'snooze'>(null);
  const [secondsOpen, setSecondsOpen] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const unsub = subscribe('welfare_check', (msg: any) => {
      const data: WelfarePayload | undefined = msg?.data || msg;
      if (!data) return;
      // Targeted prompt — AlertHubDO broadcasts to every console, so only take
      // over the intended officer's screen (fail-open when no target_user_id).
      const target = (data as { target_user_id?: number | string | null }).target_user_id;
      if (target != null && String(target) !== String(user?.id)) return;
      setActive(data);
      setSecondsOpen(0);
    });
    return () => { unsub(); };
  }, [subscribe, user?.id]);

  useEffect(() => {
    if (active && !tickRef.current) {
      tickRef.current = setInterval(() => setSecondsOpen((s) => s + 1), 1000);
    }
    if (!active && tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    };
  }, [active]);

  if (!active) return null;

  const handle = async (which: 'ack' | 'help' | 'snooze') => {
    if (submitting) return;
    setSubmitting(which);
    try {
      await apiFetch(`/api/dispatch/welfare/${which}`, { method: 'POST' });
      setActive(null);
    } catch (err) {
      console.error(`[welfare] ${which} failed`, err);
      // Keep modal open so officer can retry; do not silently dismiss.
    } finally {
      setSubmitting(null);
    }
  };

  // Pulse harder once we've been open >60 s — visual escalation cue
  const urgent = secondsOpen > 60;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="welfare-title"
      className="fixed inset-0 z-welfare-check flex items-center justify-center p-4"
      style={{ background: 'rgba(0 0 0 / 0.92)' }}
    >
      <div
        className={`w-full max-w-xl border-4 flex flex-col max-h-[90dvh] overflow-hidden ${urgent ? 'animate-pulse' : ''}`}
        style={{
          background: 'var(--surface-overlay)',
          borderColor: urgent ? 'var(--sev-critical)' : 'var(--accent-silver-400)',
          borderRadius: 2,
          boxShadow: `0 0 50px ${urgent ? 'var(--sev-critical)' : 'var(--accent-silver-400)'}`,
        }}
      >
        {/* ── Scrollable body (header + message + urgent banner) ── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="flex items-center gap-3 border-b pb-4" style={{ borderColor: urgent ? 'var(--sev-critical)' : 'var(--accent-silver-400)' }}>
            {/* Fix: icons use silver per design-system — gold is reserved for field-labels/panel-headers only */}
            <Activity className={`w-9 h-9 ${urgent ? 'text-red-500' : 'text-accent-silver-400'}`} />
            <div className="flex-1">
              <div id="welfare-title" className="text-2xl font-black uppercase tracking-wider text-rmpg-100">
                Welfare Check
              </div>
              <div className="text-[10px] uppercase tracking-wider text-rmpg-300 font-bold">
                {active.callSign ? `${active.callSign} · ` : ''}
                {active.callNumber ? `Call ${active.callNumber}` : 'Status check'}
              </div>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-mono text-rmpg-400">
              <Clock className="w-3 h-3" />
              <span>{Math.floor(secondsOpen / 60).toString().padStart(2, '0')}:{(secondsOpen % 60).toString().padStart(2, '0')}</span>
            </div>
          </div>

          <div className="text-sm text-rmpg-100 leading-relaxed">
            {active.message || 'Dispatch requesting status check. Please confirm.'}
          </div>

          {urgent && (
            <div className="flex items-center gap-2 px-3 py-2 border" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.15)', borderColor: 'var(--sev-critical)', borderRadius: 2 }}>
              <ShieldAlert className="w-4 h-4 text-red-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-300">
                No response after 60 s — supervisor alerted.
              </span>
            </div>
          )}
        </div>

        {/* ── Sticky response buttons — always visible at the bottom ── */}
        <div className="px-6 pb-6 pt-2 space-y-2" style={{ background: 'var(--surface-overlay)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handle('ack')}
              disabled={submitting !== null}
              autoFocus
              className="py-4 text-base font-black uppercase tracking-wider disabled:opacity-50"
              style={{ background: 'var(--sev-ok)', color: 'black', borderRadius: 2 }}
            >
              {submitting === 'ack' ? 'SENDING…' : 'CODE 4'}
            </button>
            <button
              type="button"
              onClick={() => handle('help')}
              disabled={submitting !== null}
              className="py-4 text-base font-black uppercase tracking-wider disabled:opacity-50"
              style={{ background: 'var(--sev-critical)', color: 'black', borderRadius: 2 }}
            >
              {submitting === 'help' ? 'BROADCASTING…' : 'NEED HELP'}
            </button>
            <button
              type="button"
              onClick={() => handle('snooze')}
              disabled={submitting !== null}
              className="py-4 text-base font-black uppercase tracking-wider disabled:opacity-50"
              style={{ background: 'var(--surface-raised)', color: 'var(--text-primary)', borderRadius: 2 }}
            >
              {submitting === 'snooze' ? '…' : 'SNOOZE 5'}
            </button>
          </div>

          <div className="text-[9px] text-fg-muted text-center uppercase tracking-wider">
            CODE 4 = on-scene safe · NEED HELP = emergency broadcast · SNOOZE = reset timer
          </div>
        </div>
      </div>
    </div>
  );
}
