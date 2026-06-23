// ============================================================
// RMPG Flex — Serve Intake Phase 1 Quality Gate: heuristic checker
// ============================================================
// runHeuristics() performs fast, deterministic checks against the
// fields extracted by serveIntakeExtract.ts. It is intentionally
// source-agnostic — it only cares about the extracted value and
// whether that value appears in the raw document text.
//
// The LLM-backed judgeMerged() function is Task 5 and lives in a
// separate export of this same file (not implemented here).
// ============================================================

import type { ExtractedField } from './serveIntakeExtract';

export interface FieldVerdict {
  ok: boolean;
  reason: string | null;
  suggested_value: string | null;
  judge_confidence: number;
  source: 'heuristic' | 'claude' | 'workers_ai';
}

export interface RawDoc { name: string; text: string }

// Full US state/territory 2-letter codes.
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP',
]);

// 5-digit or 5+4 with optional hyphen (84084 or 84084-1234).
const ZIP_RE = /^\d{5}(?:-?\d{4})?$/;

// ISO date YYYY-MM-DD.
const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── Helpers ──────────────────────────────────────────────────

function containsCaseInsensitive(rawDocs: RawDoc[], needle: string): boolean {
  if (!needle.trim()) return false;
  const n = needle.toLowerCase();
  return rawDocs.some(d => d.text.toLowerCase().includes(n));
}

function pass(): FieldVerdict {
  return { ok: true, reason: null, suggested_value: null, judge_confidence: 0.95, source: 'heuristic' };
}

function fail(reason: string): FieldVerdict {
  return { ok: false, reason, suggested_value: null, judge_confidence: 0.9, source: 'heuristic' };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Run deterministic heuristic checks on the extracted fields.
 *
 * Only fields present in `fields` are checked — callers receive an
 * entry in the output only for keys they passed in.  Unknown keys
 * are ignored so the function remains forward-compatible as the
 * field set grows.
 *
 * Checks performed:
 *   - Name fields (first/last/business): value must appear verbatim
 *     (case-insensitive) in at least one raw document.
 *   - recipient_address: at least one whitespace-delimited token of
 *     ≥3 chars must appear in a raw document.
 *   - recipient_state: must be a real US 2-letter state/territory code.
 *   - recipient_zip: must match 5-digit or ZIP+4 format.
 *   - recipient_dob: must be ISO YYYY-MM-DD in the range 1900..today
 *     (uses Date.UTC to avoid timezone drift on the host).
 */
export function runHeuristics(
  fields: Record<string, ExtractedField>,
  rawDocs: RawDoc[],
): Record<string, FieldVerdict> {
  const out: Record<string, FieldVerdict> = {};

  // ── Name fields: must appear in source text ────────────────
  for (const key of ['recipient_first_name', 'recipient_last_name', 'recipient_business_name'] as const) {
    const f = fields[key];
    if (!f?.value) continue;
    out[key] = containsCaseInsensitive(rawDocs, f.value)
      ? pass()
      : fail('value not found in any source document');
  }

  // ── Address: at least one significant token must appear ────
  const addr = fields.recipient_address;
  if (addr?.value) {
    const tokens = addr.value.split(/\s+/).filter(t => t.length >= 3);
    const hit = tokens.some(t => containsCaseInsensitive(rawDocs, t));
    out.recipient_address = hit ? pass() : fail('no token appears in any source document');
  }

  // ── State: valid US 2-letter code ─────────────────────────
  const state = fields.recipient_state;
  if (state?.value) {
    out.recipient_state = US_STATES.has(state.value.toUpperCase())
      ? pass()
      : fail(`'${state.value}' is not a valid US state or territory code`);
  }

  // ── ZIP: 5-digit or ZIP+4 ─────────────────────────────────
  const zip = fields.recipient_zip;
  if (zip?.value) {
    out.recipient_zip = ZIP_RE.test(zip.value)
      ? pass()
      : fail('zip is not 5 or 9 digits');
  }

  // ── DOB: ISO date in 1900..today ──────────────────────────
  // Use Date.UTC throughout to avoid the "one day off" timezone bug
  // that afflicts `new Date(isoString)` parsing in non-UTC environments.
  const dob = fields.recipient_dob;
  if (dob?.value) {
    const m = DOB_RE.exec(dob.value);
    if (!m) {
      out.recipient_dob = fail('dob is not in ISO YYYY-MM-DD format');
    } else {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const ms = Date.UTC(year, month - 1, day);
      const min = Date.UTC(1900, 0, 1);
      const now = Date.now();
      out.recipient_dob = (ms >= min && ms <= now)
        ? pass()
        : fail('dob outside valid range (1900–today)');
    }
  }

  return out;
}
