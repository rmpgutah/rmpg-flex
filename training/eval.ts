// ============================================================
// RMPG Flex — Serve-Intake extraction scorer
// ============================================================
// Pure, deterministic scoring of an extraction against ground truth.
// Used by run-eval.ts to compare the stock 70B vs a LoRA adapter over
// the held-out val set. No model calls here — just expected vs predicted.
//
// The aggregate metric this produces is the ONLY objective signal that a
// fine-tune helped (or regressed). Treat it as the gate before you set
// SERVE_INTAKE_LORA in prod.
// ============================================================

import { TARGET_FIELDS, type TargetField } from '../src/utils/serveIntakeExtract';

export type FieldOutcome = 'correct' | 'wrong' | 'missed' | 'hallucinated' | 'true_negative';

// How critical each field is. A wrong case_number or recipient_last_name can
// send a server to the wrong door or void service; a missing middle initial is
// cosmetic. The aggregate score is a WEIGHTED average so the fine-tune is
// rewarded for getting the load-bearing fields right, not for padding easy ones.
export const FIELD_WEIGHTS: Partial<Record<TargetField, number>> = {
  recipient_last_name: 5, recipient_first_name: 4, recipient_dob: 5,
  recipient_address: 4, recipient_city: 3, recipient_state: 2, recipient_zip: 3,
  case_number: 5, court_name: 2, plaintiff: 2, defendant: 2,
  document_type: 3, recipient_type: 3,
  // everything unlisted defaults to weight 1
};
const DEFAULT_WEIGHT = 1;
const weightOf = (f: TargetField) => FIELD_WEIGHTS[f] ?? DEFAULT_WEIGHT;

// ─────────────────────────────────────────────────────────────
// scoreField — classify one field's outcome (correct/wrong/missed/
// hallucinated/true_negative). Both inputs are trimmed; "" = field absent.
//
// ── DRAFT rubric (Claude's first pass — review the per-field choices) ──
// Field classes decide what "match" means. Rationale per class below.
//
//  EXACT_DIGITS — compare digits only. A transposed digit is a REAL failure
//    (wrong door / wrong account), so no fuzzy credit. zip/phone/bar are pure
//    digit identifiers; the pipeline already strips formatting.
const EXACT_DIGITS = new Set<TargetField>([
  'recipient_zip', 'recipient_phone', 'attorney_phone', 'attorney_bar_number',
]);
//  EXACT_DATES — ISO strings; the pipeline normalized them. Exact equality.
const EXACT_DATES = new Set<TargetField>([
  'recipient_dob', 'filing_date', 'service_deadline', 'hearing_date',
]);
//  EXACT_ID — case numbers: alphanumeric, case-insensitive, punctuation-free
//    ("24FL013222N" === "24fl013222n"). Still strict on the characters.
const EXACT_ID = new Set<TargetField>(['case_number']);
//  ENUM — closed vocab; lowercase exact ('business' !== 'person').
const ENUM = new Set<TargetField>(['recipient_type', 'document_type']);
//  CONTAINS — long institutional / multi-word fields where a subset OR superset
//    still counts as "read correctly." A court name legitimately appears as
//    "Third Judicial District Court" or "…Court, State of Utah - Matheson"; a
//    plaintiff as "Capital One, N.A." or its full "…successor by merger…" form.
//    Penalizing those as wrong would understate a LoRA that's actually right.
//    Guarded (shorter side ≥ 2 significant tokens) so a stray fragment can't
//    match — a genuinely WRONG name is neither a subset nor a superset.
const CONTAINS = new Set<TargetField>([
  'court_name', 'plaintiff', 'defendant', 'client_name', 'attorney_name',
  'recipient_business_name', 'documents_to_serve',
]);
//  Everything else (split names, city, address…) is free text where OCR/casing/
//    punctuation noise is NOT a real error — match case-insensitively on
//    collapsed, de-punctuated text. Intentionally NOT fuzzy/Levenshtein: a
//    wrong NAME still counts as wrong, just not a wrong CASE.

const digits = (s: string) => s.replace(/\D/g, '');
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// collapse case, punctuation runs, and whitespace for fair text comparison.
const norm = (s: string) => s.toLowerCase().replace(/[.,/#!$%^&*;:{}=_`~()'-]/g, ' ').replace(/\s+/g, ' ').trim();
// substring-containment match for CONTAINS fields, with a min-token guard.
function containsMatch(e: string, p: string): boolean {
  const ne = norm(e), np = norm(p);
  if (ne === np) return true;
  const [short, long] = ne.length <= np.length ? [ne, np] : [np, ne];
  const sigToks = short.split(' ').filter((t) => t.length > 1).length;
  return sigToks >= 2 && long.includes(short);
}

export function scoreField(
  field: TargetField,
  expected: string,
  predicted: string,
): FieldOutcome {
  const e = expected.trim();
  const p = predicted.trim();
  // Presence first — these four cases are field-agnostic.
  if (!e && !p) return 'true_negative';   // correctly left blank
  if (!e && p) return 'hallucinated';     // invented a value that isn't there
  if (e && !p) return 'missed';           // failed to read a present value

  // Both present → does it match under this field's rule?
  let match: boolean;
  if (EXACT_DIGITS.has(field)) match = digits(e) === digits(p) && digits(e) !== '';
  else if (EXACT_DATES.has(field)) match = e === p;            // already ISO-normalized
  else if (EXACT_ID.has(field)) match = alnum(e) === alnum(p);
  else if (ENUM.has(field)) match = e.toLowerCase() === p.toLowerCase();
  else if (CONTAINS.has(field)) match = containsMatch(e, p);   // subset/superset OK
  else match = norm(e) === norm(p);                            // free text

  return match ? 'correct' : 'wrong';
}

// ─────────────────────────────────────────────────────────────
// Everything below is wired and does not need changes.

export interface DocScore {
  id: string;
  weightedScore: number;          // 0..1, weighted over scorable fields
  outcomes: Record<string, FieldOutcome>;
}

export interface AggregateScore {
  docs: number;
  meanWeightedScore: number;
  // counts per outcome across every (doc × field) pair
  totals: Record<FieldOutcome, number>;
  // per-field accuracy = correct / (fields where expected was non-empty)
  perFieldRecall: Array<{ field: TargetField; recall: number; n: number }>;
}

// 'true_negative' and 'correct' both count as "the model did the right thing".
// 'missed' / 'wrong' / 'hallucinated' are failures. We fold true_negative in at
// full credit so a doc isn't penalized for the many fields that SHOULD be blank.
const CREDIT: Record<FieldOutcome, number> = {
  correct: 1, true_negative: 1, wrong: 0, missed: 0, hallucinated: 0,
};

export function scoreDoc(
  id: string,
  expected: Partial<Record<TargetField, string>>,
  predicted: Partial<Record<TargetField, string>>,
): DocScore {
  const outcomes: Record<string, FieldOutcome> = {};
  let num = 0;
  let den = 0;
  for (const f of TARGET_FIELDS) {
    const exp = (expected[f] ?? '').trim();
    const pred = (predicted[f] ?? '').trim();
    const outcome = scoreField(f, exp, pred);
    outcomes[f] = outcome;
    const w = weightOf(f);
    num += CREDIT[outcome] * w;
    den += w;
  }
  return { id, weightedScore: den ? num / den : 1, outcomes };
}

export function aggregate(scores: DocScore[]): AggregateScore {
  const totals: Record<FieldOutcome, number> = {
    correct: 0, wrong: 0, missed: 0, hallucinated: 0, true_negative: 0,
  };
  const recallNum: Partial<Record<TargetField, number>> = {};
  const recallDen: Partial<Record<TargetField, number>> = {};
  for (const s of scores) {
    for (const f of TARGET_FIELDS) {
      const o = s.outcomes[f] as FieldOutcome;
      totals[o]++;
      if (o === 'correct' || o === 'wrong' || o === 'missed') {
        recallDen[f] = (recallDen[f] ?? 0) + 1;            // field was present in truth
        if (o === 'correct') recallNum[f] = (recallNum[f] ?? 0) + 1;
      }
    }
  }
  const perFieldRecall = TARGET_FIELDS
    .map((field) => ({ field, n: recallDen[field] ?? 0, recall: (recallDen[field] ?? 0) ? (recallNum[field] ?? 0) / (recallDen[field] as number) : 1 }))
    .filter((r) => r.n > 0)
    .sort((a, b) => a.recall - b.recall);
  const meanWeightedScore = scores.length
    ? scores.reduce((acc, s) => acc + s.weightedScore, 0) / scores.length
    : 0;
  return { docs: scores.length, meanWeightedScore, totals, perFieldRecall };
}
