// ============================================================
// RMPG Flex — Premise Alert Modal (MDT)
// Full-screen takeover when a premise alert is auto-pushed
// from dispatch to the assigned unit. Officer must acknowledge
// before the modal dismisses.
// ============================================================

import { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, MapPin, X } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';

export interface PremiseAlertItem {
  id: number;
  address: string;
  alert_type: string;
  alert_level: string;
  title: string;
  description: string | null;
  flags: string[];
  distance_meters: number;
  latitude: number;
  longitude: number;
}

interface PremiseAlertPayload {
  call_id: number | string;
  call_number: string;
  unit_id: number | string;
  alerts: PremiseAlertItem[];
  pushed_at: string;
}

const LEVEL_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: 'rgba(239,68,68,0.18)', border: '#ef4444', text: '#ef4444', label: 'CRITICAL' },
  warning:  { bg: 'rgba(245,158,11,0.18)', border: '#f59e0b', text: '#f59e0b', label: 'WARNING' },
  info:     { bg: 'rgba(136,136,136,0.18)', border: '#888888', text: '#cccccc', label: 'INFO' },
};

function styleFor(level: string) {
  return LEVEL_STYLE[level] || LEVEL_STYLE.info;
}

export default function PremiseAlertModal() {
  const { subscribe } = useWebSocket();
  const [queue, setQueue] = useState<PremiseAlertPayload[]>([]);

  useEffect(() => {
    const unsub = subscribe('premise_alert_for_unit', (msg: any) => {
      const data: PremiseAlertPayload | undefined = msg?.data || msg;
      if (!data || !Array.isArray(data.alerts) || data.alerts.length === 0) return;
      setQueue((prev) => {
        // De-dup by call_id — same call shouldn't pop twice if dispatched in succession
        if (prev.some((p) => String(p.call_id) === String(data.call_id))) return prev;
        return [...prev, data];
      });
    });
    return () => { unsub(); };
  }, [subscribe]);

  if (queue.length === 0) return null;

  const top = queue[0];
  const topLevel = top.alerts[0]?.alert_level || 'warning';
  const s = styleFor(topLevel);

  const acknowledge = () => {
    setQueue((q) => q.slice(1));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="premise-alert-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <div
        className="w-full max-w-2xl border-4 p-5 space-y-4"
        style={{ background: '#0a0a0a', borderColor: s.border, borderRadius: 2, boxShadow: `0 0 40px ${s.border}` }}
      >
        <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: s.border }}>
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 animate-pulse" style={{ color: s.text }} />
            <div>
              <div id="premise-alert-title" className="text-2xl font-black uppercase tracking-wider" style={{ color: s.text }}>
                Premise Alert
              </div>
              <div className="text-[10px] uppercase tracking-wider text-rmpg-300 font-bold">
                Call {top.call_number} · {top.alerts.length} active alert{top.alerts.length !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <span
            className="text-[10px] font-black uppercase tracking-wider px-2 py-1"
            style={{ background: s.border, color: '#0a0a0a', borderRadius: 2 }}
          >
            {s.label}
          </span>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto scrollbar-dark">
          {top.alerts.map((a) => {
            const as_ = styleFor(a.alert_level);
            return (
              <div
                key={a.id}
                className="border p-3 space-y-1.5"
                style={{ background: as_.bg, borderColor: as_.border, borderRadius: 2 }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <AlertTriangle className="w-4 h-4" style={{ color: as_.text }} />
                  <span className="text-sm font-black uppercase tracking-wider" style={{ color: as_.text }}>
                    {a.title}
                  </span>
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                    style={{ background: as_.border, color: '#0a0a0a', borderRadius: 2 }}
                  >
                    {as_.label}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-rmpg-300">
                  <MapPin className="w-3 h-3" />
                  <span>{a.address}</span>
                  <span className="text-rmpg-500">· {a.distance_meters}m from call</span>
                </div>
                {a.description && (
                  <div className="text-xs text-rmpg-100 whitespace-pre-wrap">
                    {a.description}
                  </div>
                )}
                {a.flags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {a.flags.map((f) => (
                      <span
                        key={f}
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                        style={{ background: '#1a1a1a', color: '#d4a017', borderRadius: 2 }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={acknowledge}
          autoFocus
          className="w-full py-3 text-sm font-black uppercase tracking-wider"
          style={{ background: s.border, color: '#0a0a0a', borderRadius: 2 }}
        >
          ACKNOWLEDGE ALERT
          {queue.length > 1 && (
            <span className="ml-2 text-[10px] opacity-75">({queue.length - 1} more queued)</span>
          )}
        </button>
      </div>
    </div>
  );
}
