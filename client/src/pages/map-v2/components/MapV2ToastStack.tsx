import { useEffect, useState } from 'react';
import { useWebSocket } from '../../../context/WebSocketContext';
import { AlertTriangle, X } from 'lucide-react';

interface Toast {
  id: string;
  kind: 'p1' | 'panic';
  title: string;
  body: string;
  createdAt: number;
}

const TOAST_TTL_MS = 8000;
const MAX_TOASTS = 4;

/**
 * Live event toast stack — top-right floating column under the layers
 * panel. Surfaces new P1 calls and panic alerts for ~8s each so
 * dispatchers see major events even if they were looking elsewhere.
 *
 * Auto-dismisses after TTL; click X to dismiss early. Caps at 4
 * concurrent toasts (oldest dropped) so a flood doesn't paper-block
 * the map.
 */
export default function MapV2ToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const push = (t: Omit<Toast, 'createdAt'>) => {
      setToasts((prev) => {
        const next = [...prev, { ...t, createdAt: Date.now() }];
        while (next.length > MAX_TOASTS) next.shift();
        return next;
      });
    };

    const onDispatch = (msg: any) => {
      const data = msg.data || msg;
      if (data?.action !== 'call_created') return;
      const c = data.call;
      if (!c || c.priority !== 'P1') return;
      push({
        id: `p1-${c.id}-${Date.now()}`,
        kind: 'p1',
        title: `P1 ${c.call_number || ''}`.trim(),
        body: `${c.incident_type || ''} ${c.location || ''}`.trim(),
      });
    };
    const onPanic = (msg: any) => {
      const data = msg.data || msg;
      const officer = data?.officer_name || data?.user_name || 'Officer';
      push({
        id: `panic-${data?.id || Date.now()}-${Date.now()}`,
        kind: 'panic',
        title: 'PANIC',
        body: officer,
      });
    };

    const unsubD = subscribe('dispatch_update', onDispatch);
    const unsubP = subscribe('panic_alert', onPanic);
    return () => { unsubD(); unsubP(); };
  }, [subscribe]);

  // Tick to expire stale toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setInterval(() => {
      setToasts((prev) => prev.filter((x) => Date.now() - x.createdAt < TOAST_TTL_MS));
    }, 500);
    return () => clearInterval(t);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="absolute top-16 right-2 z-30 flex flex-col gap-1 w-[260px] select-none pointer-events-none">
      {toasts.map((t) => {
        const color = t.kind === 'panic' ? '#ef4444' : '#d4a017';
        return (
          <div
            key={t.id}
            className="bg-[#0a0a0a] border-2 px-2 py-1.5 font-mono text-[10px] pointer-events-auto"
            style={{ borderColor: color }}
            role="alert"
          >
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color }} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="font-bold tracking-wider uppercase" style={{ color }}>{t.title}</div>
                <div className="text-[#e5e7eb] truncate">{t.body}</div>
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                aria-label={`Dismiss ${t.title}`}
                className="p-0.5 text-[#666666] hover:text-[#e5e7eb]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
