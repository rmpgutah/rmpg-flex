/**
 * FleetRouteOptimizer — self-contained collapsible panel for a fleet manager
 * to plan an optimized daily route for a vehicle across multiple service stops.
 *
 * Placed inside a vehicle detail view.  Does not require D1 table entries —
 * stops are added manually with an address and geocoded through the Mapbox
 * proxy.
 */

import React, { useState, useCallback, useId } from 'react';
import {
  Route, ChevronDown, ChevronRight, Plus, X, ArrowUp, ArrowDown,
  Loader2, CheckCircle, AlertCircle, Navigation, MapPin, Clock,
} from 'lucide-react';
import {
  useFleetRouteOptimization,
  geocodeAddress,
  type FleetStop,
} from '../hooks/useFleetRouteOptimization';
import { parseTimestamp } from '../../../utils/dateUtils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayDenver(hour: number, minute = 0): string {
  const d = new Date();
  // Build a naive local-ish ISO string for the Denver shift window.
  // The optimizer uses the string as the "start of shift" anchor for ETAs.
  d.setHours(hour, minute, 0, 0);
  return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

function fmtTime(iso: string): string {
  try {
    return parseTimestamp(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Denver',
    });
  } catch {
    return iso;
  }
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.round(sec / 60)} min`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  vehicleId: string;
  unitId?: string | null;        // assigned_unit_id (string) from FleetVehicle
  callSign: string;
  vehicleLat?: number;
  vehicleLng?: number;
  className?: string;
}

interface DraftStop {
  key: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  geocoding: boolean;
  error: string | null;
}

let nextId = 1;
function makeKey() { return `stop-${nextId++}`; }

// ─── Component ────────────────────────────────────────────────────────────────

export default function FleetRouteOptimizer({
  callSign,
  vehicleLat,
  vehicleLng,
  className = '',
}: Props) {
  const uid = useId();
  const [expanded, setExpanded] = useState(false);
  const [drafts, setDrafts] = useState<DraftStop[]>([]);
  const [newAddress, setNewAddress] = useState('');
  const [shiftStart, setShiftStart] = useState(() => todayDenver(7, 0));
  const [shiftEnd, setShiftEnd] = useState(() => todayDenver(17, 0));

  const { status, elapsedMs, optimizedRoute, error, startOptimization, reset } =
    useFleetRouteOptimization();

  // ── Stop management ────────────────────────────────────────────────────────

  const addStop = useCallback(async () => {
    const raw = newAddress.trim();
    if (!raw) return;
    setNewAddress('');
    const key = makeKey();
    const draft: DraftStop = {
      key,
      name: raw,
      address: raw,
      lat: null,
      lng: null,
      geocoding: true,
      error: null,
    };
    setDrafts((prev) => [...prev, draft]);
    const coords = await geocodeAddress(raw);
    setDrafts((prev) =>
      prev.map((d) =>
        d.key === key
          ? coords
            ? { ...d, lat: coords.lat, lng: coords.lng, geocoding: false }
            : { ...d, geocoding: false, error: 'Address not found — try a more specific address' }
          : d,
      ),
    );
  }, [newAddress]);

  const removeStop = useCallback((key: string) => {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
    reset();
  }, [reset]);

  const moveStop = useCallback((key: string, dir: -1 | 1) => {
    setDrafts((prev) => {
      const idx = prev.findIndex((d) => d.key === key);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
    reset();
  }, [reset]);

  // ── Optimization ───────────────────────────────────────────────────────────

  const readyStops: FleetStop[] = drafts
    .filter((d) => d.lat != null && d.lng != null && !d.geocoding)
    .map((d, i) => ({ id: i + 1, name: d.name, lat: d.lat!, lng: d.lng! }));

  const canOptimize =
    readyStops.length >= 2 &&
    status !== 'pending' &&
    !!shiftStart;

  const handleOptimize = useCallback(async () => {
    reset();
    const oLat = vehicleLat ?? 40.7608;
    const oLng = vehicleLng ?? -111.891;
    await startOptimization(callSign, oLat, oLng, readyStops, shiftStart, shiftEnd);
  }, [callSign, vehicleLat, vehicleLng, readyStops, shiftStart, shiftEnd, startOptimization, reset]);

  // ── Navigation export ──────────────────────────────────────────────────────

  const exportNavigation = useCallback(() => {
    if (!optimizedRoute) return;
    const wps = optimizedRoute.stops
      .map((s) => {
        const draft = drafts.find((d) => d.name === s.name);
        if (!draft?.lat || !draft?.lng) return null;
        return `${draft.lat},${draft.lng}`;
      })
      .filter(Boolean)
      .join(';');
    window.open(`/navigation?waypoints=${encodeURIComponent(wps)}`, '_blank');
  }, [optimizedRoute, drafts]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`bg-surface-raised border border-rmpg-700 rounded ${className}`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-rmpg-700/40 transition-colors"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-[color:var(--panel-header-color)] uppercase tracking-wide">
          <Route className="w-3.5 h-3.5" />
          Route Optimizer
        </span>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-rmpg-400" />
          : <ChevronRight className="w-3.5 h-3.5 text-rmpg-400" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Stop list */}
          <div className="space-y-1">
            {drafts.length === 0 && (
              <p className="text-[10px] text-rmpg-500 italic py-1">
                Add at least two stops to optimize a route.
              </p>
            )}
            {drafts.map((d, idx) => (
              <div key={d.key} className="flex items-start gap-1.5 bg-surface-sunken border border-rmpg-700 rounded px-2 py-1.5">
                <span className="text-[9px] text-rmpg-500 font-mono w-4 shrink-0 pt-0.5">{idx + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-rmpg-100 font-medium truncate">{d.name}</div>
                  {d.geocoding && (
                    <div className="flex items-center gap-1 text-[9px] text-rmpg-400 mt-0.5">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Geocoding…
                    </div>
                  )}
                  {!d.geocoding && d.lat != null && (
                    <div className="text-[9px] text-rmpg-500 font-mono mt-0.5">
                      {d.lat.toFixed(5)}, {d.lng!.toFixed(5)}
                    </div>
                  )}
                  {d.error && (
                    <div className="text-[9px] text-red-400 mt-0.5">{d.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveStop(d.key, -1)}
                    disabled={idx === 0}
                    aria-label="Move stop up"
                    className="p-0.5 rounded hover:bg-rmpg-600 text-rmpg-400 hover:text-rmpg-100 disabled:opacity-30"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveStop(d.key, 1)}
                    disabled={idx === drafts.length - 1}
                    aria-label="Move stop down"
                    className="p-0.5 rounded hover:bg-rmpg-600 text-rmpg-400 hover:text-rmpg-100 disabled:opacity-30"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStop(d.key)}
                    aria-label="Remove stop"
                    className="p-0.5 rounded hover:bg-red-900/40 text-rmpg-500 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add stop */}
          <div className="flex gap-1.5">
            <label htmlFor={`${uid}-addr`} className="sr-only">Stop address</label>
            <input
              id={`${uid}-addr`}
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStop(); } }}
              placeholder="Address or location name…"
              className="flex-1 bg-surface-sunken border border-rmpg-600 rounded px-2 py-1 text-xs text-rmpg-100 placeholder-rmpg-600 focus:outline-none focus:border-brand-500"
            />
            <button
              type="button"
              onClick={addStop}
              disabled={!newAddress.trim()}
              className="toolbar-btn disabled:opacity-40"
              aria-label="Add stop"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* Shift window */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`${uid}-start`} className="block text-[9px] text-[color:var(--field-label-color)] mb-0.5 uppercase">
                Shift Start
              </label>
              <input
                id={`${uid}-start`}
                type="datetime-local"
                value={shiftStart}
                onChange={(e) => setShiftStart(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-end`} className="block text-[9px] text-[color:var(--field-label-color)] mb-0.5 uppercase">
                Shift End
              </label>
              <input
                id={`${uid}-end`}
                type="datetime-local"
                value={shiftEnd}
                onChange={(e) => setShiftEnd(e.target.value)}
                className="w-full bg-surface-sunken border border-rmpg-600 rounded px-2 py-1 text-xs text-rmpg-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          {/* Origin note */}
          <p className="text-[9px] text-rmpg-600 italic">
            {vehicleLat != null
              ? `Origin: vehicle GPS position (${vehicleLat.toFixed(4)}, ${vehicleLng?.toFixed(4)})`
              : 'Origin: downtown SLC fallback (no vehicle GPS available)'}
          </p>

          {/* Optimize button */}
          <button
            type="button"
            onClick={handleOptimize}
            disabled={!canOptimize}
            className="toolbar-btn toolbar-btn-primary w-full justify-center text-xs py-1.5 disabled:opacity-40"
          >
            {status === 'pending'
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Optimizing…</>
              : <><Route className="w-3.5 h-3.5" /> Optimize Route</>}
          </button>

          {/* Status / error */}
          {status === 'error' && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded px-2 py-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error ?? 'Optimization failed.'}
            </div>
          )}

          {/* Result */}
          {status === 'complete' && optimizedRoute && (
            <div className="space-y-2">
              {/* Summary badge row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="flex items-center gap-1 text-[10px] text-green-400 font-medium">
                  <CheckCircle className="w-3 h-3" /> Optimized
                </span>
                <span className="text-[10px] text-rmpg-400 font-mono bg-surface-sunken border border-rmpg-700 rounded px-1.5 py-0.5">
                  {optimizedRoute.totalDistanceMi} mi total
                </span>
                <span className="text-[10px] text-rmpg-500 font-mono">
                  {(elapsedMs / 1000).toFixed(1)} s
                </span>
              </div>

              {/* Ordered stop list */}
              <ol className="space-y-1">
                {optimizedRoute.stops.map((s, i) => (
                  <li key={s.stopId} className="flex items-start gap-2 bg-surface-sunken border border-rmpg-700/60 rounded px-2 py-1.5">
                    <span className="text-[9px] font-bold font-mono text-brand-400 pt-0.5 w-4 shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-rmpg-100 font-medium truncate">{s.name}</div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[9px] text-rmpg-400">
                          <Clock className="w-2.5 h-2.5" />
                          ETA {fmtTime(s.eta)}
                        </span>
                        <span className="flex items-center gap-1 text-[9px] text-rmpg-500">
                          <MapPin className="w-2.5 h-2.5" />
                          {s.odometerMi} mi cumulative
                        </span>
                        <span className="text-[9px] text-rmpg-600">
                          {fmtDuration(s.durationSec)} on-site
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              {/* Navigation export */}
              <button
                type="button"
                onClick={exportNavigation}
                className="toolbar-btn w-full justify-center text-xs py-1.5"
              >
                <Navigation className="w-3.5 h-3.5" /> Export to Navigation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
