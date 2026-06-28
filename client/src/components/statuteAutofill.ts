import type { ViolationDraft, OffenseLevel } from './violationStackHelpers';

export interface StatuteRow {
  id: number;
  citation_code: string;
  title: string;
  offense_level: string;
  default_fine: number;
  description: string;
}

function normalizeLevel(s: string): OffenseLevel {
  const t = s.toLowerCase();
  if (t.startsWith('fel')) return 'Felony';
  if (t.startsWith('mis')) return 'Misdemeanor';
  return 'Infraction';
}

/**
 * Apply statute selection to a violation draft. Only fills fields that
 * are still at their default/empty state. Once an officer has typed
 * something, this never overwrites it.
 *
 * Subtle: 'Infraction' is also the default offense_level on a fresh
 * draft, so we can't distinguish "officer chose Infraction" from
 * "default Infraction". Tie-breaker: if `statute_id` is already set
 * (this isn't the first statute pick), treat the current level as
 * officer-chosen. First-time fills normalize from the statute row.
 */
export function applyStatuteAutofill(draft: ViolationDraft, statute: StatuteRow): ViolationDraft {
  const officerHasLevel = draft.statute_id !== undefined;
  return {
    ...draft,
    statute_id: statute.id,
    statute_citation: statute.citation_code,
    description: draft.description.trim() ? draft.description : (statute.description || statute.title),
    offense_level: officerHasLevel ? draft.offense_level : normalizeLevel(statute.offense_level),
    fine_amount: draft.fine_amount > 0 ? draft.fine_amount : statute.default_fine,
  };
}
