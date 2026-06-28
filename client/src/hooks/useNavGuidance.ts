// ============================================================
// RMPG Flex — useNavGuidance Hook
// ============================================================
// The "advanced GPS direction" brain layered on top of useMapRouting.
// It turns a static route into a live, spoken, hazard-aware turn-by-turn
// navigator:
//
//   1. Upcoming-maneuver computation — finds the *next* turn (and the one
//      after it) and the live distance to it from the device's GPS.
//   2. Spoken guidance — distance-gated, de-duplicated voice: a pre-alert
//      ("In a quarter mile, turn right onto 300 East") then an imminent
//      cue ("Turn right now"), plus drive-start, reroute, and arrival.
//   3. Hazard-ahead alerts (CAD-unique) — scans active calls/incidents
//      within a corridor of the route and warns, voice + banner, when a
//      high-priority hazard lies on the path ahead.
//   4. Arrival detection — fires once when the device reaches the dest.
//
// All voice is gated by the GLOBAL voice toggle plus a per-route `muted`
// flag the banner owns. The hook is pure aside from those announcements.
// ============================================================

import { useEffect, useMemo, useRef } from 'react';
import { snapToRoute, type RouteInfo, type RouteProgress, type RouteGeom } from './useMapRouting';
import {
  announceNavStart,
  announceManeuver,
  announceHazardAhead,
  announceReroute,
  announceArrival,
} from '../utils/voiceAlerts';

// ─── Tuning constants ───────────────────────────────────────
/** Pre-announce the next maneuver when within this distance (meters ≈ 0.3 mi). */
const PRE_ALERT_M = 480;
/** "Now" cue when the maneuver is this close (meters). */
const IMMINENT_M = 60;
/** How far off the route line a hazard may be to count as "on your path" (m). */
const HAZARD_CORRIDOR_M = 120;
/** Only warn about hazards within this distance ahead (meters ≈ 1 mi). */
const HAZARD_LOOKAHEAD_M = 1600;
/** Remaining distance at which arrival fires (meters). */
const ARRIVE_M = 40;

// ─── Public types ───────────────────────────────────────────

export type NavHazardSeverity = 'critical' | 'high' | 'normal';

/** A point hazard (active call/incident) the route may pass near. */
export interface NavHazard {
  id: string;
  lat: number;
  lng: number;
  /** Short label, e.g. "26-CFS00110 · Domestic". */
  label: string;
  /** Hazard type/incident description for the spoken phrase. */
  kind: string;
  severity: NavHazardSeverity;
}

/** A maneuver as rendered in the nav banner. */
export interface NavManeuver {
  instruction: string;
  modifier?: string;
  maneuverType: string;
  /** A unicode direction glyph for the banner. */
  arrow: string;
  /** Distance to this maneuver from the device, formatted. */
  distanceText: string;
  distanceMeters: number;
}

export interface NavHazardAhead {
  hazard: NavHazard;
  distanceText: string;
  distanceMeters: number;
}

export interface NavGuidanceState {
  /** The upcoming maneuver (the one to announce/show), or null. */
  next: NavManeuver | null;
  /** The maneuver after `next`, for a "then …" preview. */
  then: NavManeuver | null;
  /** The nearest active hazard ahead on the route, or null. */
  hazardAhead: NavHazardAhead | null;
  /** True once the device has reached the destination. */
  arrived: boolean;
}

interface UseNavGuidanceParams {
  /** Navigation is active (route present + nav mode on). */
  active: boolean;
  route: RouteInfo | null;
  progress: RouteProgress | null;
  geom: RouteGeom | null;
  /** Device live position. */
  position: { lat: number; lng: number } | null;
  /** Candidate hazards to scan against the route corridor. */
  hazards: NavHazard[];
  /** Spoken destination label. */
  destLabel: string;
  /** A hazard id to exclude (the call we're driving TO). */
  destExcludeId?: string;
  /** Per-route voice mute (banner-owned). */
  muted: boolean;
  /** Off-route flag from the routing engine (drives the reroute cue). */
  offRoute: boolean;
}

// ─── Formatting + glyphs ────────────────────────────────────

function fmtDist(m: number): string {
  if (m >= 1609) return `${(m / 1609.34).toFixed(1)} mi`;
  return `${Math.max(0, Math.round((m * 3.28084) / 10) * 10)} ft`;
}

/** Spoken distance lead-in, e.g. "In a quarter mile" / "In 500 feet". */
function spokenDist(m: number): string {
  if (m >= 1400) return `In ${(m / 1609.34).toFixed(1)} miles`;
  if (m >= 720) return 'In a half mile';
  if (m >= 320) return 'In a quarter mile';
  if (m >= 130) return `In ${Math.round((m * 3.28084) / 50) * 50} feet`;
  return 'Now';
}

function maneuverArrow(type: string, modifier?: string): string {
  if (type === 'arrive') return '⚑';
  if (type === 'roundabout' || type === 'rotary') return '↻';
  const mod = (modifier || '').toLowerCase();
  if (mod.includes('uturn')) return '⮌';
  if (mod.includes('sharp left')) return '⤛';
  if (mod.includes('slight left')) return '↖';
  if (mod.includes('left')) return '⬅';
  if (mod.includes('sharp right')) return '⤜';
  if (mod.includes('slight right')) return '↗';
  if (mod.includes('right')) return '➡';
  return '⬆';
}

const EMPTY: NavGuidanceState = { next: null, then: null, hazardAhead: null, arrived: false };

// ─── Hook ───────────────────────────────────────────────────

export function useNavGuidance(params: UseNavGuidanceParams): NavGuidanceState {
  const { active, route, progress, geom, position, hazards, destLabel, destExcludeId, muted, offRoute } = params;

  // Dedup / one-shot refs.
  const destKeyRef = useRef('');
  const announcedStartRef = useRef(false);
  const arrivedRef = useRef(false);
  const spokenStepsRef = useRef<Set<string>>(new Set());
  const spokenHazardsRef = useRef<Set<string>>(new Set());
  const verRef = useRef(0);
  const prevDistRef = useRef(0);
  const prevOffRouteRef = useRef(false);

  // ── Derived navigation state (pure) ──────────────────────
  // The maneuver card is computed whenever a route exists (so a dispatcher
  // viewing a unit→call route still sees the next turn); the hazard-ahead
  // scan, however, is meaningful only while THIS device is driving the route
  // (`active`), since it keys off the device's own GPS.
  const derived = useMemo<NavGuidanceState>(() => {
    if (!route || !route.steps?.length) return EMPTY;

    const total = route.distanceMeters;
    const remaining = progress?.remainingMeters ?? total;
    const traveled = Math.min(Math.max(total - remaining, 0), total);

    // Cumulative distance to the START of each step's maneuver.
    const steps = route.steps;
    const cumStart: number[] = [0];
    for (let i = 1; i < steps.length; i++) cumStart[i] = cumStart[i - 1] + steps[i - 1].distanceMeters;

    // The upcoming maneuver = first step whose maneuver point is ahead of us.
    let nextIdx = steps.length - 1; // default to the arrive step
    for (let i = 0; i < steps.length; i++) {
      if (cumStart[i] > traveled + 1) { nextIdx = i; break; }
    }
    const toManeuver = (i: number, distM: number): NavManeuver => ({
      instruction: steps[i].instruction,
      modifier: steps[i].modifier,
      maneuverType: steps[i].maneuverType,
      arrow: maneuverArrow(steps[i].maneuverType, steps[i].modifier),
      distanceText: fmtDist(Math.max(0, distM)),
      distanceMeters: Math.max(0, Math.round(distM)),
    });
    const distToNext = cumStart[nextIdx] - traveled;
    const next = toManeuver(nextIdx, distToNext);
    const then = nextIdx + 1 < steps.length ? toManeuver(nextIdx + 1, cumStart[nextIdx + 1] - traveled) : null;

    // ── Hazard-ahead corridor scan (driver mode only) ──
    let hazardAhead: NavHazardAhead | null = null;
    if (active && geom && geom.coords.length >= 2 && hazards.length) {
      const here = position
        ? snapToRoute(geom.coords, geom.cum, position.lat, position.lng).distAlong
        : traveled;
      let best: NavHazardAhead | null = null;
      for (const h of hazards) {
        if (h.id === destExcludeId) continue;
        if (!Number.isFinite(h.lat) || !Number.isFinite(h.lng)) continue;
        const { offRouteMeters, distAlong } = snapToRoute(geom.coords, geom.cum, h.lat, h.lng);
        if (offRouteMeters > HAZARD_CORRIDOR_M) continue;
        const ahead = distAlong - here;
        if (ahead <= 0 || ahead > HAZARD_LOOKAHEAD_M) continue;
        if (!best || ahead < best.distanceMeters) {
          best = { hazard: h, distanceText: fmtDist(ahead), distanceMeters: Math.round(ahead) };
        }
      }
      hazardAhead = best;
    }

    const arrived = remaining <= ARRIVE_M;
    return { next, then, hazardAhead, arrived };
  }, [active, route, progress?.remainingMeters, geom, hazards, position?.lat, position?.lng, destExcludeId]);

  // Note: `derived` is returned regardless of `active` — only voice (below)
  // and the hazard scan (above) are gated on active-driving mode.

  // ── Voice side-effects ───────────────────────────────────
  useEffect(() => {
    if (!active || !route) {
      // Reset one-shots when navigation stops.
      destKeyRef.current = '';
      announcedStartRef.current = false;
      arrivedRef.current = false;
      spokenStepsRef.current.clear();
      spokenHazardsRef.current.clear();
      return;
    }

    // New destination → reset all dedup state.
    const destKey = `${route.unitCallSign}|${route.callNumber}`;
    if (destKey !== destKeyRef.current) {
      destKeyRef.current = destKey;
      announcedStartRef.current = false;
      arrivedRef.current = false;
      spokenStepsRef.current.clear();
      spokenHazardsRef.current.clear();
      verRef.current = 0;
      prevDistRef.current = route.distanceMeters;
    }

    // Reroute (same dest, new geometry) → bump version so maneuvers re-announce.
    if (route.distanceMeters !== prevDistRef.current) {
      verRef.current += 1;
      prevDistRef.current = route.distanceMeters;
      spokenStepsRef.current.clear();
    }

    if (muted) { prevOffRouteRef.current = offRoute; return; }

    // Drive start.
    if (!announcedStartRef.current) {
      announcedStartRef.current = true;
      announceNavStart(destLabel, route.eta, route.distance, route.worstCongestion);
      prevOffRouteRef.current = offRoute;
      return; // let the start phrase land before any maneuver cue
    }

    // Off-route → recalculating (edge-triggered).
    if (offRoute && !prevOffRouteRef.current) {
      announceReroute();
      prevOffRouteRef.current = offRoute;
      return;
    }
    prevOffRouteRef.current = offRoute;

    // Arrival (one-shot).
    if (derived.arrived) {
      if (!arrivedRef.current) {
        arrivedRef.current = true;
        announceArrival(destLabel);
      }
      return;
    }

    // Maneuver guidance: pre-alert then imminent, de-duplicated per step+phase.
    const n = derived.next;
    if (n && n.maneuverType !== 'arrive') {
      const v = verRef.current;
      const stepKey = `${v}:${n.maneuverType}:${Math.round((route.distanceMeters - n.distanceMeters) / 10)}`;
      const isTurn = !!n.modifier || n.maneuverType === 'turn' || n.maneuverType === 'roundabout' || n.maneuverType === 'rotary' || n.maneuverType === 'fork' || n.maneuverType === 'merge' || n.maneuverType === 'on ramp' || n.maneuverType === 'off ramp';
      if (n.distanceMeters <= IMMINENT_M && isTurn) {
        const k = `${stepKey}:now`;
        if (!spokenStepsRef.current.has(k)) { spokenStepsRef.current.add(k); announceManeuver(`${n.instruction} now.`, true); }
      } else if (n.distanceMeters <= PRE_ALERT_M) {
        const k = `${stepKey}:pre`;
        if (!spokenStepsRef.current.has(k)) { spokenStepsRef.current.add(k); announceManeuver(`${spokenDist(n.distanceMeters)}, ${n.instruction}.`); }
      }
    }

    // Hazard-ahead voice (high/critical only — normal shows on the banner only).
    const ha = derived.hazardAhead;
    if (ha && ha.hazard.severity !== 'normal' && !spokenHazardsRef.current.has(ha.hazard.id)) {
      spokenHazardsRef.current.add(ha.hazard.id);
      if (ha.hazard.severity === 'critical') {
        announceHazardAhead(`Officer safety. ${ha.hazard.kind} ${ha.distanceText} ahead on your route.`, 'warning');
      } else {
        announceHazardAhead(`Caution. Active ${ha.hazard.kind} ${ha.distanceText} ahead on your route.`, 'caution');
      }
    }
  }, [active, route, derived, muted, offRoute, destLabel]);

  return route ? derived : EMPTY;
}
