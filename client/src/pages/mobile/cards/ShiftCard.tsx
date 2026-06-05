import { useCallback, useEffect, useRef, useState } from 'react';
import { parseTimestamp } from '../../../utils/dateUtils';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';

// Integrated officer shift control — clock-on + on-duty + fleet vehicle in one
// "Start/End Shift" action, backed by the rewrite's /api/dispatch/duty API:
//   GET  /api/dispatch/duty/me     → current shift state + vehicle options
//   POST /api/dispatch/duty/start  → clock in + unit in-service + assign vehicle
//                                     (auto take-home; 409 NEEDS_VEHICLE → pick)
//   POST /api/dispatch/duty/end    → clock out + off-duty + release vehicle
// Starting a shift assigns the officer's take-home car automatically; if none
// is set the card shows the in-service pool to pick from.

interface DutyVehicle {
  id: number;
  vehicle_number: string | null;
  vehicle_name: string | null;
  make: string | null;
  model: string | null;
  status: string;
  is_take_home: number | null;
}
interface DutyState {
  on_shift: boolean;
  time_entry: { clock_in: string } | null;
  unit: { id: number; call_sign: string } | null;
  vehicle: DutyVehicle | null;
  take_home_vehicle: DutyVehicle | null;
  available_vehicles: DutyVehicle[];
}

function hoursSince(iso: string | null): number {
  if (!iso) return 0;
  const t = parseTimestamp(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.round(((Date.now() - t) / 3600000) * 10) / 10);
}
function vehicleLabel(v: DutyVehicle | null | undefined): string {
  if (!v) return '';
  return v.vehicle_number || v.vehicle_name || `${v.make ?? ''} ${v.model ?? ''}`.trim() || `#${v.id}`;
}

export default function ShiftCard() {
  const { subscribe } = useWebSocket();

  const [state, setState] = useState<DutyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchState = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<DutyState>('/dispatch/duty/me');
      setState({
        on_shift: !!res?.on_shift,
        time_entry: res?.time_entry ?? null,
        unit: res?.unit ?? null,
        vehicle: res?.vehicle ?? null,
        take_home_vehicle: res?.take_home_vehicle ?? null,
        available_vehicles: Array.isArray(res?.available_vehicles) ? res.available_vehicles : [],
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to load shift');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchState(); }, [fetchState]);

  useEffect(() => {
    const trigger = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { fetchState(); }, 250);
    };
    const unsub = subscribe('shift_update' as any, trigger);
    return () => { unsub(); if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [subscribe, fetchState]);

  const startShift = useCallback(async (vehicleId?: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/dispatch/duty/start', {
        method: 'POST',
        body: JSON.stringify(vehicleId ? { vehicle_id: vehicleId } : {}),
      });
      setPicking(false);
      await fetchState();
    } catch (e: any) {
      // Server safety-net: no take-home car resolved → let the officer pick.
      if (e?.code === 'NEEDS_VEHICLE') {
        if (Array.isArray(e?.payload?.available_vehicles)) {
          setState((s) => (s ? { ...s, available_vehicles: e.payload.available_vehicles } : s));
        }
        setPicking(true);
      } else if (e?.code === 'NO_UNIT') {
        setError('No unit assigned — ask dispatch to assign you a unit first.');
      } else {
        setError(e?.message || 'Clock in failed');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, fetchState]);

  // Decide whether to auto-assign (take-home / standing car) or show the picker.
  const onStartClick = useCallback(() => {
    if (!state) return;
    if (!state.unit) { setError('No unit assigned — ask dispatch to assign you a unit first.'); return; }
    if (state.take_home_vehicle || state.vehicle) { startShift(); return; }
    if (state.available_vehicles.length > 0) { setPicking(true); return; }
    setError('No in-service vehicle available — see Fleet.');
  }, [state, startShift]);

  const endShift = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/dispatch/duty/end', { method: 'POST', body: JSON.stringify({}) });
      await fetchState();
    } catch (e: any) {
      setError(e?.message || 'Clock out failed');
    } finally {
      setBusy(false);
    }
  }, [busy, fetchState]);

  if (loading) {
    return (
      <section className="bg-[#141414] border border-[#222] p-3">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest mb-2">SHIFT</h2>
        <div className="h-[160px] animate-pulse bg-[#1a1a1a] border border-[#222]" />
      </section>
    );
  }

  const isActive = !!state?.on_shift;
  const hours = hoursSince(state?.time_entry?.clock_in ?? null);
  const unit = state?.unit;
  const vehicle = state?.vehicle;

  return (
    <section className="bg-[#141414] border border-[#222] p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[#d4a017] text-[10px] font-bold tracking-widest">SHIFT</h2>
        {isActive
          ? <span className="text-[#d4a017] text-xs font-bold uppercase">On Duty</span>
          : <span className="text-gray-500 text-xs uppercase">Off Duty</span>}
      </div>

      {error && <div className="text-amber-400 text-[11px] mb-2 leading-snug">{error}</div>}

      {isActive && (
        <div className="grid grid-cols-3 gap-2 mb-3 px-1">
          <div className="flex flex-col">
            <span className="text-gray-500 text-[9px] uppercase tracking-widest">Hours</span>
            <span className="text-white text-base font-bold font-mono">{hours.toFixed(1)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-gray-500 text-[9px] uppercase tracking-widest">Unit</span>
            <span className="text-white text-base font-bold font-mono truncate">{unit?.call_sign ?? '—'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-gray-500 text-[9px] uppercase tracking-widest">Vehicle</span>
            <span className="text-white text-base font-bold font-mono truncate" title={vehicleLabel(vehicle)}>{vehicleLabel(vehicle) || '—'}</span>
          </div>
        </div>
      )}

      {/* Vehicle picker — shown when no take-home car is set for the unit. */}
      {!isActive && picking && (
        <div className="mb-2 border border-[#222] bg-[#0d0d0d] p-2">
          <div className="text-gray-400 text-[9px] uppercase tracking-widest mb-1">Select your vehicle</div>
          {state && state.available_vehicles.length > 0 ? (
            <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
              {state.available_vehicles.map((v) => (
                <button key={v.id} type="button" disabled={busy} onClick={() => startShift(v.id)}
                  className="flex items-center justify-between min-h-[40px] px-2 bg-[#1a1a1a] border border-[#222] text-gray-200 text-xs hover:border-[#d4a017]">
                  <span className="truncate">{vehicleLabel(v)}{v.make ? ` · ${v.make} ${v.model ?? ''}` : ''}</span>
                  {v.is_take_home ? <span className="text-[#d4a017] text-[9px] uppercase shrink-0">Take-home</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-[11px]">No in-service vehicles available.</div>
          )}
          <button type="button" onClick={() => setPicking(false)}
            className="mt-2 w-full h-9 bg-[#1a1a1a] border border-[#222] text-gray-400 text-[10px] uppercase tracking-widest">
            Cancel
          </button>
        </div>
      )}

      {isActive ? (
        <button type="button" disabled={busy} onClick={endShift}
          className={['w-full h-11 bg-[#1a1a1a] border border-red-700 text-red-400 text-xs uppercase tracking-widest font-bold', busy ? 'opacity-50' : ''].join(' ')}>
          End Shift
        </button>
      ) : !picking ? (
        <button type="button" disabled={busy} onClick={onStartClick}
          className={['w-full h-11 bg-[#1a1a1a] border border-[#d4a017] text-[#d4a017] text-xs uppercase tracking-widest font-bold', busy ? 'opacity-50' : ''].join(' ')}>
          Start Shift
        </button>
      ) : null}
    </section>
  );
}
