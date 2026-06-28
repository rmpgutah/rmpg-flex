// Client mirror of src/utils/alprEdit.ts (separate build — see CLAUDE.md gotcha #2).
// Used by CaptureReviewEditor for inline validation + to build the verify body
// containing ONLY the fields the officer actually changed. The Worker re-validates
// authoritatively; this gives immediate feedback and keeps the payload minimal.

export const CONDITIONS = ['clean', 'minor', 'moderate', 'heavy', 'salvage'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** The editable fields, as strings in the form (year/state kept as text inputs). */
export interface CaptureEditForm {
  plate: string; state: string; make: string; model: string;
  color: string; year: string; vehicle_type: string;
  condition: string; damage_summary: string;
}

export type EditField = keyof CaptureEditForm;

/** Build a form snapshot from a capture row (any of the API shapes). */
export function formFromCapture(cap: Record<string, any>): CaptureEditForm {
  const s = (v: any) => (v == null ? '' : String(v));
  return {
    plate: s(cap.plate).toUpperCase(),
    state: s(cap.state).toUpperCase(),
    make: s(cap.make), model: s(cap.model), color: s(cap.color),
    year: s(cap.year), vehicle_type: s(cap.vehicle_type ?? cap.vehicleType),
    condition: s(cap.condition).toLowerCase(),
    damage_summary: s(cap.damage_summary ?? cap.damageSummary),
  };
}

/** Validate the plate field for inline feedback. Returns an error string or null. */
export function plateError(plate: string): string | null {
  const norm = plate.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{2,10}$/.test(norm)) return 'Plate must be 2–10 letters/numbers.';
  return null;
}

/** Diff a form against the original snapshot → only-changed verify payload.
 *  Field values are normalized lightly (trim; plate/state uppercased). */
export function buildVerifyBody(
  original: CaptureEditForm,
  edited: CaptureEditForm,
): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(edited) as EditField[]).forEach((k) => {
    const norm = (v: string) =>
      k === 'plate' ? v.toUpperCase().replace(/[\s-]/g, '')
      : k === 'state' ? v.toUpperCase().trim()
      : v.trim();
    const ov = norm(original[k]);
    const nv = norm(edited[k]);
    if (ov !== nv) out[k] = nv;
  });
  return out;
}
