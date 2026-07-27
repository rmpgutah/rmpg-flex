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
