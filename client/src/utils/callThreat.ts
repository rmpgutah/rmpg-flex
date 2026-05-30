// ============================================================
// RMPG Flex — Call Threat Posture
// Extracts officer-safety-relevant flags from a dispatch call (its own
// intrinsic threat fields) and, when available, its linked persons +
// vehicles. Feeds the shared recordPosture() engine so a call's overall
// danger reads with the same severity language as Records + NCIC.
//
// The queue cards only have the call's own fields (linked records aren't
// fetched per-card), so callThreatFlags() works with persons/vehicles
// omitted; the detail panel passes the loaded linked records for a fuller
// read (e.g. "linked subject has an active warrant").
// ============================================================

import { recordPosture, type RecordPosture } from '../components/records/recordVisuals';

const ABSENT = ['none', '0', 'n/a', 'na', '', 'not_stolen', 'recovered', 'cleared'];
function present(v?: string | null): boolean {
  return !!v && !ABSENT.includes(String(v).toLowerCase().trim());
}

/** Normalize a record's `flags` (string | {type}) array to plain strings. */
function flagStrings(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags.map((f) => (f && typeof f === 'object' ? (f as { type?: string }).type : f))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Build the posture-relevant flag list for a call. `persons`/`vehicles` are
 * the linked records (omit on the queue card where they aren't loaded).
 */
export function callThreatFlags(
  call: Record<string, any>,
  persons: Array<Record<string, any>> = [],
  vehicles: Array<Record<string, any>> = [],
): Array<string | null | undefined> {
  return [
    // ── Call's own intrinsic threat fields ──
    present(call.weapons_involved) ? 'armed weapon' : null,
    call.officer_safety_caution ? 'officer safety caution' : null,
    call.felony_in_progress ? 'felony' : null,
    call.vehicle_pursuit || call.foot_pursuit ? 'pursuit' : null,
    call.domestic_violence ? 'domestic violence caution' : null,
    call.gang_related ? 'gang' : null,
    call.hazmat ? 'hazmat' : null,
    call.mental_health_crisis ? 'mental health' : null,
    present(call.scene_safety) ? `caution ${call.scene_safety}` : null,
    // ── Linked persons ──
    ...persons.flatMap((p) => [
      ...flagStrings(p.flags),
      p.is_sex_offender ? 'sex offender' : null,
      present(p.gang_affiliation) ? 'gang' : null,
      present(p.caution_flags) ? `caution ${p.caution_flags}` : null,
      present(p.probation_parole) ? p.probation_parole : null,
      p.watchlist_match ? 'watchlist' : null,
    ]),
    // ── Linked vehicles ──
    ...vehicles.flatMap((v) => [
      ...flagStrings(v.flags),
      present(v.stolen_status) ? 'stolen vehicle' : null,
      v.hazmat ? 'hazmat' : null,
    ]),
  ];
}

/** Convenience: posture for a call (+ optional linked records). */
export function callPosture(
  call: Record<string, any>,
  persons: Array<Record<string, any>> = [],
  vehicles: Array<Record<string, any>> = [],
): RecordPosture {
  return recordPosture(callThreatFlags(call, persons, vehicles));
}
