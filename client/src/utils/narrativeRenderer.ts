// ============================================================
// RMPG Flex — Terseness-aware Call Narrative Renderer
//
// Builds spoken dispatch text from a call's structured fields.
// The shape of the output depends on the user's voice persona
// terseness setting (from useVoicePersona / localStorage):
//
//   narrative — full prose: "New call, priority one, domestic
//               disturbance at 123 Main Street, apartment 4B,
//               zone Delta-2 beat 14. Unit 3-Adam assigned."
//
//   standard  — CAD shorthand: "P1 domestic, 123 Main,
//               Delta-2-14, 3-Adam."
//
//   terse     — minimum viable: "P1 domestic, 123 Main, 3-Adam."
//
// Empty slots are silently skipped in every mode. The renderer
// is a pure function — no side effects, no localStorage reads.
// Callers pass `mode` explicitly so we can unit-test each path.
// ============================================================

export type Terseness = 'narrative' | 'standard' | 'terse';

export interface CallSlots {
  call_number?: string;
  priority?: number;
  incident_type?: string;
  location_address?: string;
  apartment?: string;
  zone_code?: string;
  beat_code?: string;
  /** Full chart dispatch code ("SL1-SLC/A") when available — preferred for narration. */
  dispatch_code?: string;
  suspect_description?: string;
  vehicle_description?: string;
  assigned_units?: string[];
}

function priorityWord(p?: number): string {
  if (p === 1) return 'priority one';
  if (p === 2) return 'priority two';
  if (p === 3) return 'priority three';
  return '';
}

/** Abbreviate common street-type suffixes to their single-letter form. */
function shortStreet(addr?: string): string {
  if (!addr) return '';
  return addr.replace(
    /\b(Street|Avenue|Boulevard|Road|Drive|Lane|Court)\b/gi,
    (m) => m[0],
  );
}

export function renderCallNarrative(call: CallSlots, mode: Terseness): string {
  if (mode === 'terse') {
    const parts: string[] = [];
    if (call.priority) parts.push(`P${call.priority} ${call.incident_type ?? ''}`.trim());
    if (call.location_address) parts.push(shortStreet(call.location_address));
    if (call.assigned_units?.length) parts.push(call.assigned_units.join(', '));
    return parts.filter(Boolean).join(', ');
  }

  // dispatch_code is already in chart format ("SL1-SLC/A") when present;
  // fall back to legacy "{zone}-{beat}" reading otherwise.
  if (mode === 'standard') {
    const parts: string[] = [];
    if (call.priority) parts.push(`P${call.priority} ${call.incident_type ?? ''}`.trim());
    if (call.location_address) parts.push(shortStreet(call.location_address));
    if (call.dispatch_code) parts.push(call.dispatch_code);
    else if (call.zone_code && call.beat_code) parts.push(`${call.zone_code}-${call.beat_code}`);
    else if (call.zone_code) parts.push(call.zone_code);
    if (call.assigned_units?.length) parts.push(call.assigned_units.join(', '));
    return parts.filter(Boolean).join(', ');
  }

  // narrative
  const parts: string[] = ['New call'];
  if (call.priority) parts.push(priorityWord(call.priority));
  if (call.incident_type) parts.push(call.incident_type);
  if (call.location_address) {
    let loc = `at ${call.location_address}`;
    if (call.apartment) loc += `, apartment ${call.apartment}`;
    parts.push(loc);
  }
  if (call.dispatch_code) {
    parts.push(`dispatch code ${call.dispatch_code}`);
  } else if (call.zone_code) {
    let geo = `zone ${call.zone_code}`;
    if (call.beat_code) geo += ` beat ${call.beat_code}`;
    parts.push(geo);
  }
  if (call.suspect_description) parts.push(`Suspect is ${call.suspect_description}`);
  if (call.vehicle_description) parts.push(`Vehicle: ${call.vehicle_description}`);
  if (call.assigned_units?.length) parts.push(`Unit ${call.assigned_units.join(', ')} assigned`);
  return parts.join(', ') + '.';
}
