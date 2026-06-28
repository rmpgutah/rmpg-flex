// src/utils/tripEngine.ts
// Pure trip state machine. No D1, no Hono, no env — the route handlers (gps.ts,
// calls.ts) and the cron sweep apply the returned intents. Kept pure so it can
// later drop into a per-unit TripTrackerDO unchanged ("B-ready").
//
// CALLER WRITE CONTRACT (the apply-layer MUST persist these after each intent):
//   • open:    INSERT the trip; seed anchor_lat/lng = start_lat/lng,
//              last_move_at = startTs, last_fix_ts = startTs.
//   • append:  set last_fix_ts = fix.ts (advances the idempotency gate); fold the
//              fix into the telemetry aggregate.
//   • updateAnchor (only emitted alongside append when a patrol moves beyond the
//              radius): set anchor_lat/lng = {lat,lng} and last_move_at = at.
//   • close:   set status='closed', end_time=endTs, end_lat/lng, close_reason.
// The engine READS last_fix_ts / last_move_at / anchor_* but only mutates them via
// these intents — a caller that skips them will re-append forever or never idle-close.

import { haversineM, type IncomingFix } from './tripTelemetry';

export type TripType = 'call_response' | 'patrol';
export type CloseReason = 'onscene' | 'cleared' | 'idle_timeout' | 'off_duty' | 'redispatch' | 'stale' | 'manual';

export interface ActiveTrip {
  id: number;
  trip_type: TripType;
  call_id: number | null;
  anchor_lat: number | null;
  anchor_lng: number | null;
  last_move_at: number | null; // epoch ms
  last_fix_ts: number | null;  // epoch ms — idempotency
}

export type TripEvent =
  | { kind: 'status'; status: string }
  | { kind: 'gps'; fix: IncomingFix }
  | { kind: 'sweep' };

export interface EngineCtx {
  now: number;
  curLat: number | null;
  curLng: number | null;
  prevLat: number | null;
  prevLng: number | null;
  callId?: number | null;
  callNumber?: string | null;
  callType?: string | null;
  stationaryRadiusM?: number;
  idleMs?: number;
  staleMs?: number;
}

export interface EngineDecision {
  close?: { tripId: number; reason: CloseReason; endTs: number; endLat: number | null; endLng: number | null };
  open?: { type: TripType; startTs: number; startLat: number | null; startLng: number | null;
           callId?: number | null; callNumber?: string | null; callType?: string | null; prevTripId?: number | null };
  append?: { tripId: number; fix: IncomingFix };
  updateAnchor?: { lat: number; lng: number; at: number };
}

const MOVING_STATUSES = new Set(['enroute']);
const ONSCENE = 'onscene';
const AVAILABLE = 'available';
const TERMINAL = new Set(['cleared', 'closed', 'cancelled', 'archived']);
const OFFLINE = new Set(['off_duty', 'out_of_service']);

const RADIUS = (c: EngineCtx) => c.stationaryRadiusM ?? 30;
const IDLE = (c: EngineCtx) => c.idleMs ?? 300_000;
const STALE = (c: EngineCtx) => c.staleMs ?? 900_000;

export function decide(event: TripEvent, active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  if (event.kind === 'status') return decideStatus(event.status, active, ctx);
  if (event.kind === 'gps') return decideGps(event.fix, active, ctx);
  return decideSweep(active, ctx);
}

function decideStatus(status: string, active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  const d: EngineDecision = {};
  if (MOVING_STATUSES.has(status)) {
    // Idempotent: a repeat/duplicate enroute for the SAME call must not close +
    // reopen (which would fragment one response into spurious near-zero trips).
    if (active && active.trip_type === 'call_response' && active.call_id === (ctx.callId ?? null)) {
      return d;
    }
    // A call-less enroute (e.g. a direct unit-status flip with no call context)
    // must NOT open a phantom CALL_RESPONSE with call_id=NULL. Only a real call
    // (callId present) opens a response trip; otherwise leave any active trip be
    // (a PATROL keeps running; the gps path opens one on movement).
    if (ctx.callId == null) {
      return d;
    }
    if (active) {
      d.close = { tripId: active.id, reason: 'redispatch', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    }
    d.open = {
      type: 'call_response', startTs: ctx.now, startLat: ctx.curLat, startLng: ctx.curLng,
      callId: ctx.callId ?? null, callNumber: ctx.callNumber ?? null, callType: ctx.callType ?? null,
      prevTripId: active?.id ?? null,
    };
    return d;
  }
  if (status === ONSCENE) {
    if (active && active.trip_type === 'call_response') {
      d.close = { tripId: active.id, reason: 'onscene', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    }
    return d;
  }
  if (status === AVAILABLE) {
    // Unit freed from a call → close an active CALL_RESPONSE (the call ended).
    // A PATROL unit is *already* 'available' (available + moving = patrolling),
    // so a redundant 'available' must NOT close an active patrol.
    if (active && active.trip_type === 'call_response') {
      d.close = { tripId: active.id, reason: 'cleared', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    }
    return d;
  }
  if (TERMINAL.has(status)) {
    if (active) d.close = { tripId: active.id, reason: 'cleared', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    return d;
  }
  if (OFFLINE.has(status)) {
    if (active) d.close = { tripId: active.id, reason: 'off_duty', endTs: ctx.now, endLat: ctx.curLat, endLng: ctx.curLng };
    return d;
  }
  return d;
}

function decideGps(fix: IncomingFix, active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  const d: EngineDecision = {};

  // Never open/append a trip on a non-finite fix — a NaN start coordinate would
  // persist into a court-facing trip row. (The accumulator also validates, but
  // the engine must not even open a trip on garbage.)
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || !Number.isFinite(fix.ts)) return {};

  if (!active) {
    const moved =
      (fix.speed != null && fix.speed * 2.236936 > 2) ||
      (ctx.prevLat != null && ctx.prevLng != null &&
        haversineM(ctx.prevLat, ctx.prevLng, fix.lat, fix.lng) > RADIUS(ctx));
    if (moved) {
      d.open = { type: 'patrol', startTs: fix.ts, startLat: ctx.prevLat ?? fix.lat, startLng: ctx.prevLng ?? fix.lng };
    }
    return d;
  }

  if (active.last_fix_ts != null && fix.ts <= active.last_fix_ts) return d;

  if (active.trip_type === 'call_response') {
    d.append = { tripId: active.id, fix };
    return d;
  }

  const withinRadius = active.anchor_lat != null && active.anchor_lng != null &&
    haversineM(active.anchor_lat, active.anchor_lng, fix.lat, fix.lng) <= RADIUS(ctx);

  if (withinRadius) {
    if (active.last_move_at != null && ctx.now - active.last_move_at > IDLE(ctx)) {
      d.close = { tripId: active.id, reason: 'idle_timeout', endTs: active.last_move_at,
        endLat: active.anchor_lat, endLng: active.anchor_lng };
      return d;
    }
    d.append = { tripId: active.id, fix };
    return d;
  }

  d.append = { tripId: active.id, fix };
  d.updateAnchor = { lat: fix.lat, lng: fix.lng, at: fix.ts };
  return d;
}

function decideSweep(active: ActiveTrip | null, ctx: EngineCtx): EngineDecision {
  const d: EngineDecision = {};
  if (!active) return d;
  if (active.trip_type === 'patrol' && active.last_move_at != null && ctx.now - active.last_move_at > IDLE(ctx)) {
    d.close = { tripId: active.id, reason: 'idle_timeout', endTs: active.last_move_at,
      endLat: active.anchor_lat, endLng: active.anchor_lng };
    return d;
  }
  if (active.last_fix_ts != null && ctx.now - active.last_fix_ts > STALE(ctx)) {
    d.close = { tripId: active.id, reason: 'stale', endTs: active.last_fix_ts, endLat: active.anchor_lat, endLng: active.anchor_lng };
  }
  return d;
}
