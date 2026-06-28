// Pure normalization + validation for officer edits to an ALPR capture
// (the /alpr/capture/:id/verify route). No I/O — unit-tested in
// tests/alprEdit.test.ts. The client mirrors this in client/src/utils/captureEdit.ts
// (separate build; see CLAUDE.md gotcha #2), so keep the rules in sync.

export const CONDITIONS = ['clean', 'minor', 'moderate', 'heavy', 'salvage'] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface CaptureEditInput {
  plate?: unknown; state?: unknown; make?: unknown; model?: unknown;
  color?: unknown; year?: unknown; vehicle_type?: unknown;
  condition?: unknown; damage_summary?: unknown;
}

export interface NormalizedEdit {
  plate?: string; state?: string | null; make?: string | null; model?: string | null;
  color?: string | null; year?: number | null; vehicle_type?: string | null;
  condition?: string | null; damage_summary?: string | null;
}

export interface EditError { field: string; message: string; }

export interface NormalizeResult { values: NormalizedEdit; errors: EditError[]; }

const TEXT_MAX = 60;
const DAMAGE_MAX = 280;

/** Trim a free-text attribute; '' / whitespace → null (clears the field). */
function normText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

/** Normalize + validate a partial capture edit. Only keys PRESENT in `input`
 *  (not `undefined`) appear in `values`, so the caller updates only supplied
 *  columns. `maxYear` is injected to keep this pure (no `Date` here). */
export function normalizeCaptureEdit(
  input: CaptureEditInput,
  opts: { maxYear?: number } = {},
): NormalizeResult {
  const maxYear = opts.maxYear ?? 2100;
  const values: NormalizedEdit = {};
  const errors: EditError[] = [];
  const has = (k: keyof CaptureEditInput) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined;

  // Plate: required-shape when supplied. A plate can't be blanked — empty is an error.
  if (has('plate')) {
    const norm = String(input.plate ?? '').toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{2,10}$/.test(norm)) {
      errors.push({ field: 'plate', message: 'Plate must be 2–10 letters/numbers.' });
    } else {
      values.plate = norm;
    }
  }

  // State/region: 2–3 letters, uppercased; blank clears it.
  if (has('state')) {
    const raw = String(input.state ?? '').trim();
    if (!raw) { values.state = null; }
    else {
      const norm = raw.toUpperCase().replace(/[^A-Z]/g, '');
      if (norm.length < 2 || norm.length > 3) {
        errors.push({ field: 'state', message: 'State/region must be 2–3 letters.' });
      } else { values.state = norm; }
    }
  }

  // Year: integer in [1900, maxYear]; blank clears it.
  if (has('year')) {
    const raw = input.year;
    if (raw === '' || raw === null) { values.year = null; }
    else {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (!Number.isInteger(n) || n < 1900 || n > maxYear) {
        errors.push({ field: 'year', message: `Year must be 1900–${maxYear}.` });
      } else { values.year = n; }
    }
  }

  // Condition: one of the known buckets, lowercased; blank clears it.
  if (has('condition')) {
    const raw = String(input.condition ?? '').trim().toLowerCase();
    if (!raw) { values.condition = null; }
    else if ((CONDITIONS as readonly string[]).includes(raw)) { values.condition = raw; }
    else { errors.push({ field: 'condition', message: `Condition must be one of: ${CONDITIONS.join(', ')}.` }); }
  }

  if (has('make')) values.make = normText(input.make, TEXT_MAX);
  if (has('model')) values.model = normText(input.model, TEXT_MAX);
  if (has('color')) values.color = normText(input.color, TEXT_MAX);
  if (has('vehicle_type')) values.vehicle_type = normText(input.vehicle_type, TEXT_MAX);
  if (has('damage_summary')) values.damage_summary = normText(input.damage_summary, DAMAGE_MAX);

  return { values, errors };
}

/** Human-readable diff for the audit trail (only changed fields). */
export function describeEdit(before: Record<string, any>, values: NormalizedEdit): string {
  const parts: string[] = [];
  for (const k of Object.keys(values) as (keyof NormalizedEdit)[]) {
    const nv = values[k];
    const ov = before[k];
    // Treat null/'' as equivalent "empty" so we don't log no-op clears.
    const norm = (x: any) => (x == null || x === '' ? null : x);
    if (norm(ov) !== norm(nv)) parts.push(`${k}: ${ov ?? '∅'} → ${nv ?? '∅'}`);
  }
  return parts.join('; ');
}
