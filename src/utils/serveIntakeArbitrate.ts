// ============================================================
// RMPG Flex — Serve Intake cross-document arbitration
// ============================================================
// A packet is three documents that disagree. The Field Sheet's Case and
// Court cells are frequently blank (or watermark-corrupted) while the
// Court Docket has them authoritatively; the Information Form is the
// operational record for service mechanics.
//
// Rather than "last write wins", each field has a source precedence, and
// the LOSING candidate is retained so the review UI can offer it instead
// of silently discarding a value a human might prefer.
// ============================================================

import type { ExtractedField } from './serveIntakeExtract';

export interface DocCandidate {
  docType: string;                              // 'info_page' | 'field_sheet' | 'court_filing' | ...
  fields: Record<string, ExtractedField>;
}

export interface FieldConflict {
  field: string;
  chosen: string;
  chosenSource: string;
  rejected: Array<{ value: string; source: string }>;
}

export interface ArbitrationResult {
  merged: Record<string, ExtractedField>;
  conflicts: FieldConflict[];
}

// Higher wins. Service mechanics come from the operational record; the
// case caption comes from the court's own filing.
const MECHANICS_RANK: Record<string, number> = { info_page: 3, field_sheet: 2, court_filing: 1 };
const CAPTION_RANK: Record<string, number> = { court_filing: 3, info_page: 2, field_sheet: 1 };

const CAPTION_FIELDS = new Set([
  'case_number', 'court_name', 'jurisdiction', 'plaintiff', 'defendant',
  'filing_date', 'hearing_date', 'attorney_name', 'attorney_bar_number',
]);

function rankFor(field: string, docType: string): number {
  const table = CAPTION_FIELDS.has(field) ? CAPTION_RANK : MECHANICS_RANK;
  return table[docType] ?? 0;
}

export function arbitrateFields(candidates: DocCandidate[]): ArbitrationResult {
  const byField = new Map<string, Array<{ value: string; confidence: number; source: string }>>();

  for (const c of candidates) {
    for (const [field, ef] of Object.entries(c.fields)) {
      const value = (ef?.value || '').trim();
      if (!value) continue;                    // empty candidates never compete
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field)!.push({ value, confidence: ef.confidence ?? 0, source: c.docType });
    }
  }

  const merged: Record<string, ExtractedField> = {};
  const conflicts: FieldConflict[] = [];

  for (const [field, entries] of byField) {
    // Sort by source precedence, then by model confidence as the tiebreak.
    const sorted = [...entries].sort((a, b) => {
      const r = rankFor(field, b.source) - rankFor(field, a.source);
      return r !== 0 ? r : b.confidence - a.confidence;
    });

    const winner = sorted[0];
    merged[field] = { value: winner.value, confidence: winner.confidence };

    const disagreeing = sorted.slice(1).filter(
      (e) => e.value.toLowerCase() !== winner.value.toLowerCase(),
    );
    if (disagreeing.length) {
      conflicts.push({
        field,
        chosen: winner.value,
        chosenSource: winner.source,
        rejected: disagreeing.map((e) => ({ value: e.value, source: e.source })),
      });
    }
  }

  return { merged, conflicts };
}

// ============================================================
// Identity name-coherence reconciliation
// ============================================================
// arbitrateFields() above picks a winner PER FIELD independently, which
// can stitch recipient_first_name from one document onto
// recipient_last_name from another and invent a person who appears in
// neither doc. src/routes/serveIntake.ts runs a separate "name-coherence
// guard" AFTER arbitration that instead takes the WHOLE identity field
// group from the single document with the strongest recipient signal.
// That guard can override arbitration's per-field pick, so `conflicts`
// has to be reconciled to match — otherwise the review UI could show a
// `chosen` value that disagrees with what was actually written to the
// merged field set. This is pulled out as a pure function (rather than
// left inline in the route) so it can be unit-tested without D1/R2/AI
// bindings.

/** Minimal shape reconcileIdentityConflicts needs from a per-doc extraction result. */
export interface IdentityWinnerDoc {
  documentType: string;
  fields: Record<string, ExtractedField>;
}

/**
 * Applies the name-coherence guard's chosen document to `mergedFields`
 * (mutated in place, matching the pre-extraction route behavior) for
 * every field in `identityFields`, and returns a new `conflicts` array
 * with any identity-group entries reconciled against the final chosen
 * value. Non-identity conflicts are passed through untouched.
 *
 * `winnerDoc` is the document the guard selected (or null if no document
 * had any recipient signal, in which case this is a no-op).
 */
export function reconcileIdentityConflicts(
  conflicts: FieldConflict[],
  mergedFields: Record<string, ExtractedField>,
  docCandidates: DocCandidate[],
  winnerDoc: IdentityWinnerDoc | null,
  identityFields: readonly string[],
): FieldConflict[] {
  if (!winnerDoc) return conflicts;

  let result = conflicts;
  for (const k of identityFields) {
    const v = winnerDoc.fields[k];
    // Only override with a non-empty value — a blank field on the winning
    // doc shouldn't wipe a value another doc legitimately supplied (e.g.
    // winner has the name, a second doc has the DOB).
    if (!v || !v.value) continue;

    mergedFields[k] = v;

    // Recompute against every doc's raw candidate for this field rather
    // than just the arbitration winner, so a candidate arbitration hadn't
    // flagged (same value, different rank) still shows up as rejected
    // here if it disagrees. Normalize both sides (trim + lowercase)
    // identically, or the winning value's own untrimmed form can fail
    // its own dedup check and show up self-conflicting in `rejected`.
    result = result.filter((cf) => cf.field !== k);
    const chosenNormalized = v.value.trim().toLowerCase();
    const seen = new Set<string>([chosenNormalized]);
    const rejected = docCandidates
      .map((dc) => ({ value: (dc.fields[k]?.value || '').trim(), source: dc.docType }))
      .filter((e) => e.value && !seen.has(e.value.toLowerCase()) && (seen.add(e.value.toLowerCase()), true));
    if (rejected.length) {
      result = [...result, { field: k, chosen: v.value, chosenSource: winnerDoc.documentType, rejected }];
    }
  }
  return result;
}
