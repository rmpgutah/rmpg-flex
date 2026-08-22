// ============================================================
// RMPG Flex — QuickStatusBar (Mobile)
// ============================================================
// Prominent 4-button status bar for one-thumb status updates.
// Sends PUT /api/dispatch/units/:id/status.
// Statuses: En Route, On Scene, Available, Unavailable.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { useWebSocket } from '../../../context/WebSocketContext';

type BackendStatus = 'enroute' | 'onscene' | 'available' | 'out_of_service';

interface QuickBtn {
  label: string;
  backend: BackendStatus;
  activeColor: string;
}

const BUTTONS: QuickBtn[] = [
  { label: 'En Route', backend: 'enroute', activeColor: 'bg-blue-600 border-blue-400 text-rmpg-100' },
  { label: 'On Scene', backend: 'onscene', activeColor: 'bg-green-700 border-green-400 text-rmpg-100' },
  { label: 'Available', backend: 'available', activeColor: 'bg-emerald-600 border-emerald-400 text-rmpg-100' },
  { label: 'Unavailable', backend: 'out_of_service', activeColor: 'bg-red-700 border-red-400 text-rmpg-100' },
];

interface UnitRow {
  id: number;
  officer_id?: number | null;
  status?: string;
}

export default function QuickStatusBar() {
  const { user } = useAuth();
  const { subscribe } = useWebSocket();
  const [unitId, setUnitId] = useState<number | null>(null);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unitIdRef = useRef<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  const officerId = (user as any)?.officer_id ?? (user as any)?.id ?? null;

  const fetchUnit = useCallback(async () => {
    try {
      const rows = await apiFetch<UnitRow[]>('/api/dispatch/units');
      const mine = Array.isArray(rows)
        ? rows.find((r) => String(r.officer_id) === String(officerId))
        : null;
      setUnitId(mine?.id ?? null);
      setCurrentStatus(mine?.status ?? null);
      unitIdRef.current = mine?.id ?? null;
    } catch {
      // best-effort; badge hidden if no unit found
    }
  }, [officerId]);

  useEffect(() => { void fetchUnit(); }, [fetchUnit]);

  useEffect(() => {
    const unsub = subscribe('unit_update' as any, (msg: any) => {
      const action = msg?.action ?? msg?.data?.action;
      if (action === 'unit_position_update') return;
      const payload = msg?.unit ?? msg?.data?.unit ?? msg?.data ?? null;
      const incomingId = payload?.id ?? null;
      if (!unitIdRef.current || Number(incomingId) === unitIdRef.current) {
        void fetchUnit();
      }
    });
    return unsub;
  }, [subscribe, fetchUnit]);

  const changeStatus = useCallback(async (backend: BackendStatus) => {
    if (!unitId || busy) return;
    setBusy(true);
    setFlash(backend);
    setError(null);
    try {
      await apiFetch(`/api/dispatch/units/${unitId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: backend }),
      });
      setCurrentStatus(backend);
    } catch {
      setError('Status update failed');
    } finally {
      setBusy(false);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlash(null), 600);
    }
  }, [unitId, busy]);

  if (!unitId) return null;

  return (
    <div
      className="grid grid-cols-4 gap-1.5 px-3 py-2 bg-surface-base border-b border-border-default"
      role="group"
      aria-label="Quick status update"
    >
      {BUTTONS.map((btn) => {
        const isActive = currentStatus === btn.backend;
        const isFlashing = flash === btn.backend;
        return (
          <button
            key={btn.backend}
            type="button"
            disabled={busy}
            onClick={() => { void changeStatus(btn.backend); }}
            aria-pressed={isActive}
            aria-label={`Set status ${btn.label}`}
            className={[
              'min-h-[52px] flex items-center justify-center text-center',
              'border text-[11px] font-bold uppercase tracking-wide',
              'transition-all duration-150 select-none',
              isActive || isFlashing
                ? btn.activeColor
                : 'bg-surface-raised border-border-default text-fg-muted',
              busy ? 'opacity-60' : 'active:scale-95',
            ].join(' ')}
          >
            {btn.label}
          </button>
        );
      })}
      {error && (
        <div
          role="alert"
          className="col-span-4 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--sev-critical)]"
        >
          {error}
        </div>
      )}
    </div>
  );
}
