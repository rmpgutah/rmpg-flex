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
const STATE_ZIP_PREFIX: Record<string, RegExp> = {
  UT: /^84[0-7]/,
  CA: /^9[0-5]/,
  AZ: /^85|^86/,
  NV: /^89/,
  ID: /^83/,
  WY: /^82|^83[01]/,
  CO: /^80|^81/,
  NY: /^1[0-4]/,
  TX: /^7[5-9]/,
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
