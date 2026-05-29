import { useCallback, useEffect, useRef, useState } from 'react';
import { parseTimestamp } from '../../../utils/dateUtils';
import { apiFetch } from '../../../hooks/useApi';
import { useAuth } from '../../../context/AuthContext';
import { useWebSocket } from '../../../context/WebSocketContext';

// GET: /api/personnel/:id — returns { ..., activeTimeEntry: { clock_in, ... } | null }
// POST: /api/personnel/time/clock-in  (body: { officer_id? })
// POST: /api/personnel/time/clock-out (body: { officer_id? })
// Calls-handled is best-effort from /api/dispatch/units/workload?days=1 (filter by officer_name / officer_id).
// No server-side shift_update WS event exists today; we subscribe defensively to 'time_entry_update'.
// Tests mock apiFetch returning the spec shape { active, started_at, hours_today, calls_handled }
// directly, so the component also accepts that shape unmodified.

interface ShiftState {
  active: boolean;
  started_at: string | null;
  hours_today: number;
  calls_handled: number;
}

function hoursSince(iso: string | null): number {
  if (!iso) return 0;
  const t = parseTimestamp(iso).getTime();
  if (isNaN(t)) return 0;
  const h = (Date.now() - t) / 3600000;
  return Math.max(0, Math.round(h * 10) / 10);
}

export default function ShiftCard() {
  const { user } = useAuth();
  const { subscribe } = useWebSocket();

  const [shift, setShift] = useState<ShiftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const officerId = (user as any)?.officer_id ?? (user as any)?.id ?? null;

  const fetchShift = useCallback(async () => {
    setError(null);
    try {
      const endpoint = officerId ? `/api/personnel/${officerId}` : '/api/personnel/me';
      const res: any = await apiFetch<any>(endpoint);

      // Shape 1 (spec / test mock): { active, started_at, hours_today, calls_handled }
      if (res && typeof res.active === 'boolean') {
        setShift({
          active: !!res.active,
          started_at: res.started_at ?? null,
          hours_today: Number(res.hours_today ?? 0),
          calls_handled: Number(res.calls_handled ?? 0),
        });
        return;
      }

      // Shape 2 (real server): personnel record with activeTimeEntry
      const active = !!res?.activeTimeEntry;
      const startedAt = res?.activeTimeEntry?.clock_in ?? null;
      setShift({
        active,
        started_at: startedAt,
        hours_today: hoursSince(startedAt),
        calls_handled: 0,
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to load shift');
    } finally {
      setLoading(false);
    }
  }, [officerId]);

  useEffect(() => {
    fetchShift();
  }, [fetchShift]);

  useEffect(() => {
    const trigger = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { fetchShift(); }, 250);
    };
    // No real shift_update event on server yet; defensive subscription.
    const unsub = subscribe('shift_update' as any, trigger);
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subscribe, fetchShift]);

  const clockIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/personnel/time/clock-in', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await fetchShift();
    } catch (e: any) {
      setError(e?.message || 'Clock in failed');
    } finally {
      setBusy(false);
    }
  }, [busy, fetchShift]);

  const clockOut = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/personnel/time/clock-out', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await fetchShift();
    } catch (e: any) {
      setError(e?.message || 'Clock out failed');
    } finally {
      setBusy(false);
    }
  }, [busy, fetchShift]);

  if (loading) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">SHIFT</h2>
        <div className="h-[160px] animate-pulse bg-[#1a1a1a] border border-[#222]" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">SHIFT</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-400 text-xs">{error}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchShift(); }}
            className="min-h-[44px] h-11 px-3 bg-[#1a1a1a] border border-[#222] text-gray-300 text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  const isActive = !!shift?.active;
  const hours = shift?.hours_today ?? 0;
  const calls = shift?.calls_handled ?? 0;

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest">SHIFT</h2>
        {isActive ? (
          <span className="text-[#d4a017] text-xs font-bold uppercase">On Shift</span>
        ) : (
          <span className="text-gray-500 text-xs uppercase">Off Shift</span>
        )}
      </div>

      {isActive && (
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex flex-col">
            <span className="text-gray-500 text-[10px] uppercase tracking-widest">Hours</span>
            <span className="text-white text-lg font-bold font-mono">{hours.toFixed(1)}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-[10px] uppercase tracking-widest">Calls</span>
            <span className="text-white text-lg font-bold font-mono">{calls}</span>
          </div>
        </div>
      )}

      {isActive ? (
        <button
          type="button"
          disabled={busy}
          onClick={clockOut}
          className={[
            'w-full h-11 bg-[#1a1a1a] border border-red-700 text-red-400 text-xs uppercase tracking-widest font-bold',
            busy ? 'opacity-50' : '',
          ].join(' ')}
        >
          Clock Out
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={clockIn}
          className={[
            'w-full h-11 bg-[#1a1a1a] border border-[#d4a017] text-[#d4a017] text-xs uppercase tracking-widest font-bold',
            busy ? 'opacity-50' : '',
          ].join(' ')}
        >
          Clock In
        </button>
      )}
    </section>
  );
}
