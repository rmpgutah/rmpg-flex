// ============================================================
// RMPG Flex — Referent Resolver (Phase 4)
//
// Pre-pass for the voice-channel NLU pipeline. Rewrites pronouns
// and deictics ("that call", "him", "that plate") into explicit
// references ("call CN-26-0457", "person id 1042", "plate
// 8-IDA-ROBERT-7-4-5") using the last-mentioned entity slots in
// BrainContext.
//
// Pure function: transcript + context -> { text, resolutions,
// ambiguous }. No side effects. The `resolutions` map is logged
// to audit (Phase 4 optional) so reviewers can see exactly what
// "that call" was resolved to before a mutating command fired.
//
// If a referent pattern appears but no context slot is set,
// `ambiguous` is true and the caller should kick off a
// clarification turn rather than pushing through to NLU.
// ============================================================

import type { BrainContext } from './dispatcherRules/types';

// Patterns are non-global here (just `i` flag) so we can reuse them
// for detection (`test()`) without accumulating `lastIndex` state.
// `replaceAll` below recompiles each pattern with the `g` flag so a
// single utterance with repeated referents ("that call ... the call")
// still rewrites every occurrence.
const CALL_PATTERNS     = [/\bthat call\b/i, /\bthis call\b/i, /\bthe call\b/i];
const LOCATION_PATTERNS = [/\bthat location\b/i, /\bthe location\b/i, /\bthat address\b/i, /\bthe address\b/i];
const PERSON_PATTERNS   = [/\bhim\b/i, /\bher\b/i, /\bthe subject\b/i, /\bthat person\b/i];
const UNIT_PATTERNS     = [/\bthat unit\b/i, /\bthe unit\b/i];
const PLATE_PATTERNS    = [/\bthat plate\b/i, /\bthe plate\b/i];

export interface ResolutionResult {
  /** Transcript with pronouns/deictics replaced by explicit references. */
  text: string;
  /** Slot -> resolved identifier, for audit logging. */
  resolutions: Record<string, string>;
  /** True if any pattern fired but the corresponding context slot was empty. */
  ambiguous: boolean;
  /** Human-readable tag of the missing slot, set only when ambiguous. */
  ambiguousSlot?: 'call' | 'location' | 'person' | 'unit' | 'plate';
}

/** Apply a list of regexes to `text`, replacing every match with `replacement`. */
function replaceAll(text: string, patterns: RegExp[], replacement: string): string {
  let out = text;
  for (const re of patterns) {
    // Recompile with `g` so `.replace` is global. A fresh RegExp per
    // call avoids the classic shared-lastIndex bug on g-flag regexes.
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    out = out.replace(new RegExp(re.source, flags), replacement);
  }
  return out;
}

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

export function resolveReferents(transcript: string, ctx: BrainContext): ResolutionResult {
  let text = transcript;
  const resolutions: Record<string, string> = {};
  let ambiguous = false;
  let ambiguousSlot: ResolutionResult['ambiguousSlot'];

  // Call: "that call" / "this call" / "the call" -> "call <number>"
  if (anyMatch(text, CALL_PATTERNS)) {
    if (ctx.lastCall?.call_number) {
      text = replaceAll(text, CALL_PATTERNS, `call ${ctx.lastCall.call_number}`);
      resolutions.call = ctx.lastCall.call_number;
    } else {
      ambiguous = true;
      ambiguousSlot ??= 'call';
    }
  }

  // Location: "that location" / "the address" -> "<location string>"
  if (anyMatch(text, LOCATION_PATTERNS)) {
    const loc = ctx.lastCall?.location;
    if (loc) {
      text = replaceAll(text, LOCATION_PATTERNS, loc);
      resolutions.location = loc;
    } else {
      ambiguous = true;
      ambiguousSlot ??= 'location';
    }
  }

  // Person: "him" / "her" / "the subject" / "that person" -> "person id <n>"
  if (anyMatch(text, PERSON_PATTERNS)) {
    if (ctx.lastPerson?.id != null) {
      text = replaceAll(text, PERSON_PATTERNS, `person id ${ctx.lastPerson.id}`);
      resolutions.person = String(ctx.lastPerson.id);
    } else {
      ambiguous = true;
      ambiguousSlot ??= 'person';
    }
  }

  // Unit: "that unit" / "the unit" -> "<call_sign>"
  if (anyMatch(text, UNIT_PATTERNS)) {
    if (ctx.lastUnit?.call_sign) {
      text = replaceAll(text, UNIT_PATTERNS, ctx.lastUnit.call_sign);
      resolutions.unit = ctx.lastUnit.call_sign;
    } else {
      ambiguous = true;
      ambiguousSlot ??= 'unit';
    }
  }

  // Plate: "that plate" / "the plate" -> "plate <text>"
  if (anyMatch(text, PLATE_PATTERNS)) {
    if (ctx.lastPlate?.plate) {
      text = replaceAll(text, PLATE_PATTERNS, `plate ${ctx.lastPlate.plate}`);
      resolutions.plate = ctx.lastPlate.plate;
    } else {
      ambiguous = true;
      ambiguousSlot ??= 'plate';
    }
  }

  return { text, resolutions, ambiguous, ambiguousSlot };
}
