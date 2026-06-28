// ============================================================
// RMPG Flex — useNavTravel Hook
// Travel calculation management for the Nav panel.
//
// Provides:
//   - pause/resume travel calculations (officer control)
//   - accumulated pause duration tracking
//   - data retention via localStorage (survives refresh/reload)
//   - mileage & travel summary for the current session
//   - guardrails: max speed sanity, coordinate bounds validation
//
// Off-dispatch mode: tracks travel even when no call is active,
// so the officer's vehicle and location data persists across
// patrol-to-dispatch transitions.
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Constants ──────────────────────────────────────────────
const LS_TRAVEL_KEY = 'rmpg_nav_travel_state';
const LS_TRAVEL_HISTORY_KEY = 'rmpg_nav_travel_history';
const MAX_HISTORY_ENTRIES = 50;
const MAX_PLAUSIBLE_SPEED_MPH = 120;
const MIN_VALID_LAT = 32.0;  // ~southern US
const MAX_VALID_LAT = 49.0;  // ~northern US
const MIN_VALID_LNG = -125.0; // ~western US
const MAX_VALID_LNG = -65.0;  // ~eastern US

// ─── Types ──────────────────────────────────────────────────

export interface TravelState {
  /** Whether travel calculation is currently paused */
  paused: boolean;
  /** ISO timestamp when travel was paused, null if running */
  pausedAt: string | null;
  /** Total accumulated pause duration in seconds for the current session */
  pausedDurationSec: number;
  /** Session start ISO timestamp */
  sessionStart: string;
  /** Total distance traveled in the current session, miles */
  sessionDistanceMi: number;
  /** Start odometer reading (from last known vehicle mileage) */
  startOdometer: number | null;
  /** Current/last known odometer reading */
  currentOdometer: number | null;
  /** Last known latitude */
  lastLat: number | null;
  /** Last known longitude */
  lastLng: number | null;
  /** Last known speed in mph */
  lastSpeedMph: number | null;
  /** Last position update timestamp */
  lastPositionAt: string | null;
}

export interface TravelHistoryEntry {
  /** ISO timestamp of the state snapshot */
  timestamp: string;
  /** Session distance at this point, miles */
  distanceMi: number;
  /** Whether travel was paused at this point */
  paused: boolean;
  /** Odometer reading at this point */
  odometer: number | null;
  /** Lat at this point */
  lat: number | null;
  /** Lng at this point */
  lng: number | null;
}

export interface NavTravelValidation {
  valid: boolean;
  reason?: string;
}

// ─── Load / save helpers ───────────────────────────────────

function loadTravelState(): Partial<TravelState> {
  try {
    const raw = localStorage.getItem(LS_TRAVEL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveTravelState(state: TravelState): void {
  try { localStorage.setItem(LS_TRAVEL_KEY, JSON.stringify(state)); } catch { /* full */ }
}

function loadTravelHistory(): TravelHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_TRAVEL_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTravelHistory(history: TravelHistoryEntry[]): void {
  try { localStorage.setItem(LS_TRAVEL_HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY_ENTRIES))); } catch { /* full */ }
}

// ─── Haversine ─────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!Number.isFinite(lat1) || !Number.isFinite(lng1) || !Number.isFinite(lat2) || !Number.isFinite(lng2)) return 0;
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Hook ───────────────────────────────────────────────────

export function useNavTravel() {
  const [travelState, setTravelState] = useState<TravelState>(() => {
    const saved = loadTravelState();
    return {
      paused: saved.paused ?? false,
      pausedAt: saved.pausedAt ?? null,
      pausedDurationSec: saved.pausedDurationSec ?? 0,
      sessionStart: saved.sessionStart ?? new Date().toISOString(),
      sessionDistanceMi: saved.sessionDistanceMi ?? 0,
      startOdometer: saved.startOdometer ?? null,
      currentOdometer: saved.currentOdometer ?? null,
      lastLat: saved.lastLat ?? null,
      lastLng: saved.lastLng ?? null,
      lastSpeedMph: saved.lastSpeedMph ?? null,
      lastPositionAt: saved.lastPositionAt ?? null,
    };
  });

  const stateRef = useRef(travelState);
  stateRef.current = travelState;

  const historyRef = useRef<TravelHistoryEntry[]>(loadTravelHistory());
  const lastPositionRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  // Persist state on every change
  useEffect(() => {
    saveTravelState(stateRef.current);
  }, [travelState]);

  // ─── Guardrails: validate a position update ────────────
  const validatePosition = useCallback((lat: number, lng: number, speedMph?: number | null): NavTravelValidation => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { valid: false, reason: 'Coordinates must be finite numbers' };
    }
    if (lat < MIN_VALID_LAT || lat > MAX_VALID_LAT) {
      return { valid: false, reason: `Latitude ${lat} outside valid US range (${MIN_VALID_LAT}–${MAX_VALID_LAT})` };
    }
    if (lng < MIN_VALID_LNG || lng > MAX_VALID_LNG) {
      return { valid: false, reason: `Longitude ${lng} outside valid US range (${MIN_VALID_LNG}–${MAX_VALID_LNG})` };
    }
    if (speedMph != null && speedMph > MAX_PLAUSIBLE_SPEED_MPH) {
      return { valid: false, reason: `Speed ${speedMph.toFixed(1)} mph exceeds plausible max of ${MAX_PLAUSIBLE_SPEED_MPH}` };
    }
    // Jump detection: reject teleportation (>500 mi in <10s)
    const last = lastPositionRef.current;
    if (last) {
      const elapsedSec = (Date.now() - last.time) / 1000;
      if (elapsedSec > 0 && elapsedSec < 10) {
        const dist = haversineMiles(last.lat, last.lng, lat, lng);
        const impliedSpeed = (dist / elapsedSec) * 3600;
        if (impliedSpeed > MAX_PLAUSIBLE_SPEED_MPH * 2) {
          return { valid: false, reason: `Implied speed ${impliedSpeed.toFixed(0)} mph exceeds sanity threshold (teleportation)` };
        }
      }
    }
    return { valid: true };
  }, []);

  // ─── Update position (used by GPS tracking consumers) ──
  const updatePosition = useCallback((lat: number, lng: number, speedMph?: number | null, odometer?: number | null) => {
    const validation = validatePosition(lat, lng, speedMph);
    if (!validation.valid) {
      console.warn('[useNavTravel] Position rejected:', validation.reason);
      return;
    }

    setTravelState((prev) => {
      if (prev.paused) return prev; // don't accumulate distance while paused

      const last = lastPositionRef.current;
      let distance = prev.sessionDistanceMi;
      if (last) {
        const dist = haversineMiles(last.lat, last.lng, lat, lng);
        if (dist < 0.05) return prev; // suppress micro-movements
        distance += dist;
      }

      lastPositionRef.current = { lat, lng, time: Date.now() };

      const newState: TravelState = {
        ...prev,
        sessionDistanceMi: distance,
        lastLat: lat,
        lastLng: lng,
        lastSpeedMph: speedMph ?? prev.lastSpeedMph,
        lastPositionAt: new Date().toISOString(),
        ...(odometer != null ? { currentOdometer: odometer } : {}),
        ...(odometer != null && prev.startOdometer == null ? { startOdometer: odometer } : {}),
      };

      return newState;
    });
  }, [validatePosition]);

  // ─── Pause travel calculation ──────────────────────────
  const pauseTravel = useCallback(() => {
    const now = new Date().toISOString();
    setTravelState((prev) => {
      if (prev.paused) return prev;
      const entry: TravelHistoryEntry = {
        timestamp: now,
        distanceMi: prev.sessionDistanceMi,
        paused: true,
        odometer: prev.currentOdometer,
        lat: prev.lastLat,
        lng: prev.lastLng,
      };
      historyRef.current.push(entry);
      saveTravelHistory(historyRef.current);
      return { ...prev, paused: true, pausedAt: now };
    });
  }, []);

  // ─── Resume travel calculation ─────────────────────────
  const resumeTravel = useCallback(() => {
    setTravelState((prev) => {
      if (!prev.paused) return prev;
      const pauseDuration = prev.pausedAt
        ? Math.round((Date.now() - new Date(prev.pausedAt).getTime()) / 1000)
        : 0;
      const entry: TravelHistoryEntry = {
        timestamp: new Date().toISOString(),
        distanceMi: prev.sessionDistanceMi,
        paused: false,
        odometer: prev.currentOdometer,
        lat: prev.lastLat,
        lng: prev.lastLng,
      };
      historyRef.current.push(entry);
      saveTravelHistory(historyRef.current);
      return {
        ...prev,
        paused: false,
        pausedAt: null,
        pausedDurationSec: prev.pausedDurationSec + Math.max(0, pauseDuration),
      };
    });
  }, []);

  // ─── Set odometer (officer or admin input) ─────────────
  const setOdometer = useCallback((odometer: number) => {
    if (!Number.isFinite(odometer) || odometer < 0) return;
    if (odometer > 999999) return;
    setTravelState((prev) => ({
      ...prev,
      currentOdometer: odometer,
      ...(prev.startOdometer == null ? { startOdometer: odometer } : {}),
    }));
  }, []);

  // ─── Reset session ─────────────────────────────────────
  const resetSession = useCallback(() => {
    const now = new Date().toISOString();
    const fresh: TravelState = {
      paused: false,
      pausedAt: null,
      pausedDurationSec: 0,
      sessionStart: now,
      sessionDistanceMi: 0,
      startOdometer: null,
      currentOdometer: null,
      lastLat: null,
      lastLng: null,
      lastSpeedMph: null,
      lastPositionAt: null,
    };
    lastPositionRef.current = null;
    historyRef.current = [];
    saveTravelHistory([]);
    setTravelState(fresh);
  }, []);

  // ─── Computed helpers ──────────────────────────────────

  /** Active travel time (session duration minus pause time), seconds */
  const activeTravelSec = Math.max(0,
    Math.round((Date.now() - new Date(travelState.sessionStart).getTime()) / 1000) - travelState.pausedDurationSec
    - (travelState.paused && travelState.pausedAt
      ? Math.round((Date.now() - new Date(travelState.pausedAt).getTime()) / 1000)
      : 0)
  );

  /** Average speed for the session, mph */
  const avgSpeedMph = activeTravelSec > 0
    ? (travelState.sessionDistanceMi / (activeTravelSec / 3600))
    : 0;

  /** Trip miles (from odometer delta) */
  const tripMiles = travelState.startOdometer != null && travelState.currentOdometer != null
    ? Math.max(0, travelState.currentOdometer - travelState.startOdometer)
    : null;

  return {
    travelState,
    travelHistory: historyRef.current,
    activeTravelSec,
    avgSpeedMph,
    tripMiles,
    pauseTravel,
    resumeTravel,
    updatePosition,
    setOdometer,
    resetSession,
    validatePosition,
  };
}
