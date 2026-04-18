// ============================================================
// RMPG Flex — Dispatcher Brain
//
// Orchestrates the rules engine + context memory + speak queue.
// Sits between event sources (WebSocket, timers, officer utterances)
// and the existing voice stack (voiceChannel, voiceAlerts, edgeTTS).
//
// Phase 2 scope: event fan-in for WebSocket dispatch_update payloads.
// Timer loop, state triggers, and referent resolution come in
// Phases 3 and 4.
//
// Guarded by the per-user `rmpg-voice-brain-enabled` localStorage
// flag (mirrored from users.voice_brain_enabled). Default off — the
// brain is inert until a user opts in through the Voice tab.
// ============================================================

import { findRules } from './dispatcherRules/registry';
import { enqueueSpeech } from './speakQueue';
import type { BrainContext } from './dispatcherRules/types';

const BRAIN_FLAG_KEY = 'rmpg-voice-brain-enabled';

let ctx: BrainContext = { transcript: [] };

export function isBrainEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(BRAIN_FLAG_KEY) === '1';
}

export function getBrainContext(): BrainContext {
  return ctx;
}

export function setCurrentUser(callSign: string | undefined): void {
  ctx.currentUserCallSign = callSign;
}

/** Test-only reset. Clears context, stops timer, disables the flag. */
export function __resetBrainForTest(): void {
  ctx = { transcript: [] };
  stopBrainTimer();
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(BRAIN_FLAG_KEY);
  }
}

// Update last-mentioned entity slots from an event payload so
// follow-up rules and (in Phase 4) the referent resolver can refer
// back to "that call", "him", etc.
function absorbPayloadIntoContext(payload: any): void {
  if (!payload || typeof payload !== 'object') return;

  if (payload.call_number) {
    ctx.lastCall = {
      id:           String(payload.id ?? payload.call_number),
      call_number:  String(payload.call_number),
      location:     String(payload.location_address ?? payload.location ?? ''),
      type:         String(payload.incident_type ?? ''),
    };
  }
  const callSign = payload.unit_call_sign ?? payload.call_sign;
  if (callSign) {
    ctx.lastUnit = { call_sign: String(callSign) };
  }
}

/**
 * Main entry point for WebSocket dispatch events. When the brain is
 * disabled this is a no-op, so it's safe to wire unconditionally.
 */
export function handleDispatchEvent(type: string, payload: any): void {
  if (!isBrainEnabled()) return;

  absorbPayloadIntoContext(payload);
  maybeMarkOnScene(type, payload);

  // Set the event on ctx only for the duration of rule matching + compose;
  // clear it afterward so timer/state triggers don't see stale event data.
  ctx.event = { type, payload };
  try {
    const matched = findRules({ kind: 'event', type, ctx });
    for (const rule of matched) {
      const text = rule.compose(ctx);
      if (!text) continue;
      enqueueSpeech({
        text,
        severity: rule.severity,
        ruleId: rule.id,
        entityKey: rule.entityKey?.(ctx) ?? 'global',
        cooldownMs: rule.cooldownMs,
      });
    }
  } finally {
    ctx.event = undefined;
  }
}

// ─── Timer loop (Phase 3) ───────────────────────────────────
// A 30s tick fires timer-triggered rules (e.g. overdue-status-check).
// startBrainTimer() is called once at app boot; stopBrainTimer() is
// used by tests. The tick is a no-op when the brain flag is off.

const TIMER_TICK_MS = 30_000;
let timerHandle: ReturnType<typeof setInterval> | null = null;

export function startBrainTimer(): void {
  if (timerHandle != null) return;
  timerHandle = setInterval(tickTimers, TIMER_TICK_MS);
}

export function stopBrainTimer(): void {
  if (timerHandle != null) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

/** Test-only: invoke a timer tick synchronously. */
export function __tickTimersForTest(): void {
  tickTimers();
}

function tickTimers(): void {
  if (!isBrainEnabled()) return;
  const matched = findRules({ kind: 'timer', ctx });
  for (const rule of matched) {
    const text = rule.compose(ctx);
    if (!text) continue;
    enqueueSpeech({
      text,
      severity: rule.severity,
      ruleId: rule.id,
      entityKey: rule.entityKey?.(ctx) ?? 'global',
      cooldownMs: rule.cooldownMs,
    });
  }
}

// Track when the current user's unit transitions into 'on_scene'
// status so the overdue-status timer rule has a reference point.
function maybeMarkOnScene(type: string, payload: any): void {
  if (type !== 'unit_status' && type !== 'status_update' && type !== 'unit_update') return;
  const callSign = payload?.call_sign ?? payload?.unit_call_sign ?? payload?.unit?.call_sign;
  if (!callSign || callSign !== ctx.currentUserCallSign) return;
  const status = String(payload?.status ?? payload?.unit?.status ?? '').toLowerCase();
  if (status === 'on_scene' || status === 'on scene' || status === 'onscene') {
    ctx.currentUserOnSceneAt = Date.now();
  } else if (status === 'clear' || status === 'available' || status === 'off') {
    ctx.currentUserOnSceneAt = undefined;
  }
}
