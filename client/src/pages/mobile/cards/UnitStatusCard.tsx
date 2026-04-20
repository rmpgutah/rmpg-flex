import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { useWebSocket } from '../../../context/WebSocketContext';

// Backend status vocabulary (see server/src/routes/dispatch/units.ts):
// available | dispatched | enroute | onscene | busy | off_duty | out_of_service
// We surface the four officer-actionable ones as 10-codes in the UI.
type BackendStatus =
  | 'available'
  | 'dispatched'
  | 'enroute'
  | 'onscene'
  | 'busy'
  | 'off_duty'
  | 'out_of_service';

interface Unit {
  id: number;
  call_sign?: string;
  unit_number?: string;
  officer_id?: number | null;
  status?: BackendStatus | string;
  current_call_id?: number | null;
  call_number?: string | null;
  current_call_type?: string | null;
  current_call_location?: string | null;
}

const STATUS_BUTTONS: { code: string; label: string; backend: BackendStatus }[] = [
  { code: '10-8', label: 'In Service', backend: 'available' },
  { code: '10-6', label: 'Busy', backend: 'busy' },
  { code: '10-7', label: 'Out of Service', backend: 'out_of_service' },
  { code: '10-42', label: 'End of Shift', backend: 'off_duty' },
];

function toTenCode(status?: string): string {
  switch (status) {
    case 'available': return '10-8';
    case 'busy': return '10-6';
    case 'out_of_service': return '10-7';
    case 'off_duty': return '10-42';
    case 'dispatched': return '10-76';
    case 'enroute': return '10-76';
    case 'onscene': return '10-23';
    default: return status || '—';
  }
}

function ledColor(status?: string): string {
  if (status === 'available' || status === 'onscene' || status === 'enroute' || status === 'dispatched') return 'bg-green-500';
  if (status === 'out_of_service' || status === 'off_duty') return 'bg-red-500';
  return 'bg-amber-500';
}

export default function UnitStatusCard() {
  const { user } = useAuth();
  const { subscribe } = useWebSocket();

  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unitIdRef = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const officerId = (user as any)?.officer_id ?? (user as any)?.id ?? null;

  const fetchUnit = useCallback(async () => {
    try {
      setError(null);
      // No `/units/me` on the server — pull list and filter by officer_id.
      const rows = await apiFetch<Unit[]>('/api/dispatch/units');
      const mine = Array.isArray(rows)
        ? rows.find((r) => String(r.officer_id) === String(officerId))
        : null;
      setUnit(mine || null);
      unitIdRef.current = mine?.id ?? null;
    } catch (e: any) {
      setError(e?.message || 'Failed to load unit');
    } finally {
      setLoading(false);
    }
  }, [officerId]);

  useEffect(() => {
    fetchUnit();
  }, [fetchUnit]);

  // WebSocket refresh — debounced 250ms
  useEffect(() => {
    const unsub = subscribe('unit_update' as any, (msg: any) => {
      const payload = msg?.unit ?? msg?.data?.unit ?? msg?.data ?? null;
      const incomingId = payload?.id ?? payload?.unit_id ?? null;
      const mineId = unitIdRef.current;
      // Refetch when our unit changes, OR when we don't yet have a unit
      // (a unit_created for us should bring it in).
      if (mineId == null || incomingId == null || Number(incomingId) === Number(mineId)) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { fetchUnit(); }, 250);
      }
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subscribe, fetchUnit]);

  const changeStatus = useCallback(async (backend: BackendStatus) => {
    if (!unit?.id || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/dispatch/units/${unit.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: backend }),
      });
      await fetchUnit();
    } catch (e: any) {
      setError(e?.message || 'Status change failed');
    } finally {
      setBusy(false);
    }
  }, [unit?.id, busy, fetchUnit]);

  // ─── Render ───────────────────────────────────────────────
  if (loading) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">UNIT STATUS</h2>
        <div className="h-[140px] animate-pulse bg-[#1a1a1a] border border-[#222]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">UNIT STATUS</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-400 text-xs">{error}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchUnit(); }}
            className="min-h-[44px] h-11 px-3 bg-[#1a1a1a] border border-[#222] text-gray-300 text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  if (!unit) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">UNIT STATUS</h2>
        <p className="text-gray-500 text-xs italic">Not on a unit. Use /dispatch to log on.</p>
      </section>
    );
  }

  const current = String(unit.status || '');
  const unitLabel = unit.call_sign || unit.unit_number || `Unit ${unit.id}`;
  const assignment = unit.call_number
    ? `${unit.call_number}${unit.current_call_type ? ' · ' + unit.current_call_type : ''}${unit.current_call_location ? ' · ' + unit.current_call_location : ''}`
    : null;

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">UNIT STATUS</h2>

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${ledColor(current)}`}
            style={{ boxShadow: '0 0 6px currentColor' }}
            aria-hidden="true"
          />
          <span className="text-white text-sm font-mono">{unitLabel}</span>
        </div>
        <span className="text-white text-sm font-mono">{toTenCode(current)}</span>
      </div>

      {assignment && (
        <div className="text-gray-500 text-xs mb-2 truncate" title={assignment}>
          {assignment}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {STATUS_BUTTONS.map((btn) => {
          const active = current === btn.backend;
          return (
            <button
              key={btn.code}
              type="button"
              disabled={busy}
              onClick={() => changeStatus(btn.backend)}
              className={[
                'min-h-[44px] h-11 bg-[#1a1a1a] border text-xs uppercase tracking-widest',
                active ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#222] text-gray-300',
                busy ? 'opacity-50' : '',
              ].join(' ')}
            >
              {btn.code} · {btn.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
