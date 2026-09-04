import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { parseTimestamp } from '../../../utils/dateUtils';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useAuth } from '../../../context/AuthContext';
import MileagePromptModal from '../../../components/MileagePromptModal';

// Roles that can use the manager-override path in the mileage modal.
const MANAGER_ROLES = new Set(['admin', 'manager', 'supervisor']);

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
  time_entry: { clock_in: string; qr_token?: string | null } | null;
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
  const { user } = useAuth();
  const isManager = MANAGER_ROLES.has(String((user as any)?.role ?? '').toLowerCase());

  const [state, setState] = useState<DutyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  // Mileage prompt — non-null when the modal is open. Carries the vehicle
  // chosen at the picker (for /start) and the previous reading for guardrails.
  const [mileagePrompt, setMileagePrompt] = useState<
    | { mode: 'starting'; vehicleId: number; vehicleLabel: string; previous: number | null }
    | { mode: 'ending'; vehicleLabel: string; previous: number | null }
    | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchState = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<DutyState>('/dispatch/duty/me');
      if (!mountedRef.current) return;
      setState({
        on_shift: !!res?.on_shift,
        time_entry: res?.time_entry ?? null,
        unit: res?.unit ?? null,
        vehicle: res?.vehicle ?? null,
        take_home_vehicle: res?.take_home_vehicle ?? null,
        available_vehicles: Array.isArray(res?.available_vehicles) ? res.available_vehicles : [],
      });
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load shift');
    } finally {
      if (mountedRef.current) setLoading(false);
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

  // Open the starting-mileage modal for a resolved vehicle. The actual
  // /dispatch/duty/start call happens in submitStartingMileage below — the
  // server requires the odometer reading so we can't POST until it's in hand.
  const promptStartingMileage = useCallback((v: DutyVehicle) => {
    setPicking(false);
    setError(null);
    setMileagePrompt({
      mode: 'starting',
      vehicleId: v.id,
      vehicleLabel: vehicleLabel(v),
      // Server returns previous_mileage on a 409 retry; on first open we don't
      // have it yet — guardrails will still ceiling/positive-check.
      previous: null,
    });
  }, []);

  const submitStartingMileage = useCallback(async (mileage: number, _vid: string, overrideReason?: string) => {
    if (busy || !mileagePrompt || mileagePrompt.mode !== 'starting') return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/dispatch/duty/start', {
        method: 'POST',
        body: JSON.stringify({
          vehicle_id: mileagePrompt.vehicleId,
          ...(mileage > 0 ? { starting_mileage: mileage } : {}),
          ...(overrideReason ? { override_reason: overrideReason } : {}),
        }),
      }).then((started: any) => {
        const notes: string[] = [];
        if (started?.handbook_pending) notes.push('Handbook unsigned');
        if (started?.service_due) notes.push('Vehicle due for service');
        if (started?.license_expiring) notes.push('License expiring');
        if (notes.length) setError(notes.join(' · '));
      });
      setMileagePrompt(null);
      await fetchState();
    } catch (e) {
      // Server safety-net for decreasing/too-high — re-open with the previous
      // reading so the user (or a manager) gets the in-modal warning.
      const err = e as { code?: string; message?: string; payload?: { previous_mileage?: number } };
      if (err.code === 'MILEAGE_DECREASING' || err.code === 'MILEAGE_TOO_HIGH') {
        setMileagePrompt((m) => (m && m.mode === 'starting' ? { ...m, previous: err.payload?.previous_mileage ?? null } : m));
        setError(err.message || 'Mileage rejected');
      } else if (err.code === 'NO_UNIT') {
        setMileagePrompt(null);
        setError('No unit assigned — ask dispatch to assign you a unit first.');
      } else {
        setError(err.message || 'Clock in failed');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, mileagePrompt, fetchState]);

  // Decide whether to auto-assign (take-home / standing car) or show the picker,
  // then route to the starting-mileage modal.
  const onStartClick = useCallback(() => {
    if (!state) return;
    if (!state.unit) { setError('No unit assigned — ask dispatch to assign you a unit first.'); return; }
    const auto = state.take_home_vehicle || state.vehicle;
    if (auto) { promptStartingMileage(auto); return; }
    if (state.available_vehicles.length > 0) { setPicking(true); return; }
    setError('No in-service vehicle available — see Fleet.');
  }, [state, promptStartingMileage]);

  const onEndClick = useCallback(() => {
    if (!state?.on_shift) return;
    setError(null);
    setMileagePrompt({
      mode: 'ending',
      vehicleLabel: vehicleLabel(state.vehicle),
      previous: null,
    });
  }, [state]);

  const submitEndingMileage = useCallback(async (mileage: number, _vid: string, overrideReason?: string) => {
    if (busy || !mileagePrompt || mileagePrompt.mode !== 'ending') return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/dispatch/duty/end', {
        method: 'POST',
        body: JSON.stringify({
          // 0 = Skip — server closes with the GPS-accrued fleet odometer.
          ...(mileage > 0 ? { ending_mileage: mileage } : {}),
          ...(overrideReason ? { override_reason: overrideReason } : {}),
        }),
      });
      setMileagePrompt(null);
      await fetchState();
    } catch (e) {
      const err = e as { code?: string; message?: string; payload?: { previous_mileage?: number; starting_mileage?: number } };
      if (err.code === 'MILEAGE_DECREASING' || err.code === 'MILEAGE_TOO_HIGH') {
        setMileagePrompt((m) => (m && m.mode === 'ending' ? { ...m, previous: err.payload?.previous_mileage ?? err.payload?.starting_mileage ?? null } : m));
        setError(err.message || 'Mileage rejected');
      } else {
        setError(err.message || 'Clock out failed');
      }
    } finally {
      setBusy(false);
    }
  }, [busy, mileagePrompt, fetchState]);

  // Derived shift bits — also computed during loading so the QR hooks below
  // can run unconditionally (Rules of Hooks: same order every render). The
  // values are only consumed in the post-loading render branch.
  const isActive = !!state?.on_shift;
  const qrToken = isActive ? state?.time_entry?.qr_token ?? null : null;

  // QR points at the mobile inspection page. Same origin as the SPA so it
  // works on whatever host the officer's browser is loaded from (rmpgutah.us
  // in prod, localhost in dev). The token is the credential — no JWT needed.
  const qrUrl = useMemo(() => {
    if (!qrToken) return null;
    try { return `${window.location.origin}/m/shift/${qrToken}`; } catch { return null; }
  }, [qrToken]);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qrUrl) { setQrDataUrl(null); return; }
    let alive = true;
    // High error-correction so the QR still scans from across a desk or
    // through a phone-screen glare angle — paid for in pixel density.
    //
    // Dark-on-light is NOT a style choice. ISO/IEC 18004 defines the symbol as
    // dark modules on a light background, and this QR is scanned by the
    // officer's own phone camera, which does not try inverted polarity. The
    // previous gold-on-near-black (accent-gold on surface-base) was inverted — the
    // "dark" modules were ~130x LIGHTER than the "light" ones — and its
    // near-black quiet zone dissolved into the navy card behind it, leaving no
    // quiet zone at all. Keep the encoder margin modest and let the white tile
    // in the markup supply the optical quiet zone, so raising the margin does
    // not shrink the modules at this fixed width.
    QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'H', margin: 2, width: 220, color: { dark: 'black', light: 'white' } })
      .then((url) => { if (alive) setQrDataUrl(url); })
      .catch((err) => { console.warn('[ShiftCard] QR render failed', err); if (alive) setQrDataUrl(null); });
    return () => { alive = false; };
  }, [qrUrl]);

  if (loading) {
    return (
      <section className="bg-surface-base border border-border-default p-3">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest mb-2">SHIFT</h2>
        <div className="h-[160px] animate-pulse bg-surface-raised border border-border-default" />
      </section>
    );
  }

  const hours = hoursSince(state?.time_entry?.clock_in ?? null);
  const unit = state?.unit;
  const vehicle = state?.vehicle;

  return (
    <section className="bg-surface-base border border-border-default p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest">SHIFT</h2>
        {isActive
          ? <span className="text-[color:var(--field-label-color)] text-xs font-bold uppercase">On Duty</span>
          : <span className="text-rmpg-500 text-xs uppercase">Off Duty</span>}
      </div>

      {error && <div className="text-amber-400 text-[11px] mb-2 leading-snug">{error}</div>}

      {isActive && (
        <div className="grid grid-cols-3 grid-keep gap-2 mb-3 px-1">
          <div className="flex flex-col">
            <span className="text-rmpg-500 text-[9px] uppercase tracking-widest">Hours</span>
            <span className="text-rmpg-100 text-base font-bold font-mono">{hours.toFixed(1)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-rmpg-500 text-[9px] uppercase tracking-widest">Unit</span>
            <span className="text-rmpg-100 text-base font-bold font-mono truncate">{unit?.call_sign ?? '—'}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-rmpg-500 text-[9px] uppercase tracking-widest">Vehicle</span>
            <span className="text-rmpg-100 text-base font-bold font-mono truncate" title={vehicleLabel(vehicle)}>{vehicleLabel(vehicle) || '—'}</span>
          </div>
        </div>
      )}

      {/* Vehicle picker — shown when no take-home car is set for the unit. */}
      {!isActive && picking && (
        <div className="mb-2 border border-border-default bg-surface-base p-2">
          <div className="text-rmpg-400 text-[9px] uppercase tracking-widest mb-1">Select your vehicle</div>
          {state && state.available_vehicles.length > 0 ? (
            <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
              {state.available_vehicles.map((v) => (
                <button key={v.id} type="button" disabled={busy} onClick={() => promptStartingMileage(v)}
                  className="flex items-center justify-between min-h-[44px] px-2 bg-surface-raised border border-border-default text-rmpg-200 text-xs hover:border-accent-silver-400">
                  <span className="truncate">{vehicleLabel(v)}{v.make ? ` · ${v.make} ${v.model ?? ''}` : ''}</span>
                  {v.is_take_home ? <span className="text-[color:var(--field-label-color)] text-[9px] uppercase shrink-0">Take-home</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-rmpg-500 text-[11px]">No in-service vehicles available.</div>
          )}
          <button type="button" onClick={() => setPicking(false)}
            className="mt-2 w-full h-11 bg-surface-raised border border-border-default text-rmpg-400 text-[10px] uppercase tracking-widest">
            Cancel
          </button>
        </div>
      )}

      {/* QR — scan with phone to open /m/shift/<token>: pre-shift walkthrough
          + post-shift review. Token rotates on every Start Shift and dies the
          instant the shift ends, so a stale screenshot of the QR is harmless. */}
      {isActive && qrDataUrl && (
        <div className="mb-3 border border-border-default bg-surface-base p-2 flex flex-col items-center">
          <div className="text-rmpg-400 text-[9px] uppercase tracking-widest mb-1">Scan with phone — vehicle walkthrough</div>
          {/* White tile is load-bearing, not decoration: it supplies the light
              quiet zone the symbol needs. Rendering the QR straight onto the
              navy card leaves the margin indistinguishable from the surround. */}
          <div className="bg-white p-2">
            <img src={qrDataUrl} alt="Shift inspection QR" width={180} height={180} className="block" />
          </div>
          <div className="mt-1 text-[9px] text-rmpg-500 font-mono truncate max-w-full" title={qrUrl ?? ''}>{qrUrl}</div>
        </div>
      )}

      {isActive ? (
        <button type="button" disabled={busy} onClick={onEndClick}
          className={['w-full h-11 bg-surface-raised border border-red-700 text-red-400 text-xs uppercase tracking-widest font-bold', busy ? 'opacity-50' : ''].join(' ')}>
          End Shift
        </button>
      ) : !picking ? (
        <button type="button" disabled={busy} onClick={onStartClick}
          className={['w-full h-11 bg-surface-raised border border-accent-silver-400 text-[color:var(--field-label-color)] text-xs uppercase tracking-widest font-bold', busy ? 'opacity-50' : ''].join(' ')}>
          Start Shift
        </button>
      ) : null}

      {mileagePrompt && (
        <MileagePromptModal
          mode={mileagePrompt.mode}
          callNumber={mileagePrompt.mode === 'starting' ? 'SHIFT START' : 'SHIFT END'}
          vehicleId={mileagePrompt.vehicleLabel}
          previousMileage={mileagePrompt.previous}
          isManager={isManager}
          submitLabel={mileagePrompt.mode === 'starting' ? 'Start Shift' : 'End Shift'}
          skipLabel="Skip — Use Vehicle Odometer"
          onSubmit={mileagePrompt.mode === 'starting' ? submitStartingMileage : submitEndingMileage}
          onCancel={() => setMileagePrompt(null)}
        />
      )}
    </section>
  );
}
