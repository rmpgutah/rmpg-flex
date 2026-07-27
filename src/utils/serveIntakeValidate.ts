// ============================================================
// RMPG Flex — Serve Intake deterministic validation
// ============================================================
// The model self-reports confidence, and it is optimistic. This module
// checks what can be checked WITHOUT a model and folds the result back
// into the score, so a field that contradicts itself ("UT" + a 943xx ZIP)
// cannot present as high-confidence on the review screen.
//
// Pure — no I/O, no clock read (the caller passes nowIso).
// ============================================================

import type { ExtractedField } from './serveIntakeExtract';

export interface ValidationIssue {
  field: string;
  severity: 'warn' | 'error';
  message: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  adjusted: Record<string, ExtractedField>;
}

// First three ZIP digits by state — enough to catch a cross-state paste
// without shipping a full ZIP database into the Worker bundle.
//
// Audited 2026-07-26 against the real USPS 3-digit ZIP-prefix allocation
// (Utah 840-847, California 900-961, Arizona 850-853/855-857/859-860/863-865,
// Nevada 889-891/893-898, Idaho 832-838, Wyoming 820-831, Colorado 800-816,
// New York 100-149, Texas 750-799 + the 885 Fort Bliss enclave). Every entry
// below is bounded on BOTH ends — a state's real range routinely stops short
// of (or has a gap inside) the next round number, and a merely-widened regex
// just trades a false negative for a false positive against a neighboring
// state's range:
//   - CA must stop at 961 (South Lake Tahoe/Redding), not extend to 96x —
//     967-968 is Hawaii and 969 is Guam/Micronesia.
//   - NV has a gap at 892 between the 889-891 and 893-898 blocks.
//   - AZ has gaps at 854, 858, 861-862, and above 865 (which would otherwise
//     collide with nothing today, but 866-869 is not AZ so isn't matched).
//   - ID (832-838) previously used a bare `/^83/`, which also matched 830 and
//     831 — those belong to WY (Jackson/Kemmerer), not Idaho.
//   - CO (800-816) previously used a bare `/^81/`, which also matched 817-819
//     — those are unassigned, not Colorado.
const STATE_ZIP_PREFIX: Record<string, RegExp> = {
  UT: /^84[0-7]/,
  CA: /^(9[0-5]\d|96[01])/,
  AZ: /^(85[0-3]|85[5-7]|859|86[0345])/,
  NV: /^(889|89[01]|89[3-8])/,
  ID: /^83[2-8]/,
  WY: /^82|^83[01]/,
  CO: /^(80\d|81[0-6])/,
  NY: /^1[0-4]/,
  TX: /^(7[5-9]|885)/,
};

const CONFIDENCE_PENALTY = 0.4;   // multiplicative on a failed check
const CONFIDENCE_BONUS = 1.05;    // small lift when a check actively passed

export function validateFields(
  fields: Record<string, ExtractedField>,
  nowIso = '2026-01-01T00:00:00Z',
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const adjusted: Record<string, ExtractedField> = {};
  for (const [k, v] of Object.entries(fields)) adjusted[k] = { ...v };

  const val = (k: string) => (fields[k]?.value || '').trim();

  const penalize = (field: string, severity: 'warn' | 'error', message: string) => {
    issues.push({ field, severity, message });
    if (adjusted[field]) {
      adjusted[field].confidence = Math.max(0, adjusted[field].confidence * CONFIDENCE_PENALTY);
    }
  };
  const reward = (field: string) => {
    if (adjusted[field]) {
      adjusted[field].confidence = Math.min(1, adjusted[field].confidence * CONFIDENCE_BONUS);
    }
  };

  // ZIP ↔ state agreement
  const state = val('recipient_state');
  const zip = val('recipient_zip');
  if (state && zip && STATE_ZIP_PREFIX[state]) {
    if (STATE_ZIP_PREFIX[state].test(zip)) reward('recipient_zip');
    else penalize('recipient_zip', 'error', `ZIP ${zip} is not consistent with state ${state}`);
  }

  // Phone digit count — normalizePhone already stripped punctuation.
  for (const f of ['recipient_phone', 'attorney_phone']) {
    const p = val(f);
    if (!p) continue;
    if (/^\d{10}$/.test(p)) reward(f);
    else penalize(f, 'warn', `Phone "${p}" is not 10 digits`);
  }

  // Dates must be real and, for the deadline, not already past.
  const nowMs = Date.parse(nowIso);
  for (const f of ['service_deadline', 'hearing_date', 'filing_date', 'attempt_start_not_before']) {
    const d = val(f);
    if (!d) continue;
    const ms = Date.parse(`${d}T00:00:00Z`);
    if (Number.isNaN(ms)) {
      penalize(f, 'error', `"${d}" is not a parseable date`);
      continue;
    }
    if (f === 'service_deadline' && ms < nowMs) {
      penalize(f, 'error', `Service deadline ${d} is already past`);
      continue;
    }
    reward(f);
  }

  return { issues, adjusted };
}
