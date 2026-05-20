// ============================================================
// Dispatcher Brain — Rule Types
//
// A rule is a typed entry in the registry. Rules are matched by
// trigger kind (event/timer/state) and, when relevant, by event
// type. The `compose` function produces the spoken text from the
// current brain context — it must be pure (no side effects).
// ============================================================

import type { AlertSeverity } from '../alertSeverity';

export interface BrainContext {
  /** Last call mentioned by event or officer utterance. */
  lastCall?:   { id: string; call_number: string; location: string; type: string };
  lastUnit?:   { call_sign: string; officer_name?: string };
  lastPerson?: { id: number; first_name: string; last_name: string };
  lastPlate?:  { plate: string; state: string };

  currentUserCallSign?:   string;
  currentUserOnSceneAt?:  number;
  currentUserGeofence?:   { beat: string; inBeat: boolean };

  activeCallCount?: number;
  availableUnitCount?: number;
  lastEventAt?: number;
  heldCalls?: Array<{ call_number: string; held_since: number }>;
  shiftEndTime?: string;

  transcript: Array<{ text: string; source: 'system' | 'officer'; ts: number }>;

  /** Payload for the currently-matching event (undefined for non-event triggers). */
  event?: { type: string; payload: any };
}

export interface DispatcherRule {
  id: string;
  trigger: 'event' | 'timer' | 'state';
  /** For event-triggered rules, only fire when the event type is in this list. */
  eventTypes?: string[];
  match: (ctx: BrainContext) => boolean;
  severity: AlertSeverity;
  /** Per-rule (+entityKey) silence window in ms. */
  cooldownMs: number;
  compose: (ctx: BrainContext) => string;
  /** Whether the brain should open the mic after speaking. Default 'none'. */
  followUp?: 'listen' | 'none';
  /** Entity discriminator for dedup — defaults to 'global' if omitted. */
  entityKey?: (ctx: BrainContext) => string;
}

export type TriggerEnvelope =
  | { kind: 'event'; type: string; ctx: BrainContext }
  | { kind: 'timer'; ctx: BrainContext }
  | { kind: 'state'; ctx: BrainContext };
