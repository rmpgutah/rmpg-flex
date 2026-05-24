/**
 * Run-card merge: apply dispatch_run_cards defaults to an incoming
 * call body. Caller-wins semantics — the card fills only nullish
 * fields. Priority is auto-elevated (P1 < P2 < P3 < P4 sorted by
 * urgency) but never downgraded.
 */
import type Database from 'better-sqlite3';

export type RunCard = {
  id: number;
  incident_type: string;
  label: string;
  priority: string | null;
  flags: string;             // JSON array
  min_units: number | null;
  backup_units: number | null;
  requires_supervisor: number | null;
  caution_text: string | null;
  auto_link_premise: number | null;
};

export function getRunCard(db: Database.Database, incidentType: string): RunCard | null {
  try {
    const row = db.prepare('SELECT * FROM dispatch_run_cards WHERE incident_type = ?').get(incidentType) as RunCard | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

const PRIORITY_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

function elevatePriority(caller: string | null | undefined, card: string | null | undefined): string | null {
  if (!card) return caller ?? null;
  if (!caller) return card;
  const cr = PRIORITY_RANK[caller] ?? 99;
  const dr = PRIORITY_RANK[card] ?? 99;
  return dr < cr ? card : caller;  // lower rank = higher urgency
}

export type CallDraft = {
  incident_type: string;
  priority?: string | null;
  flags?: string[] | null;
  min_units?: number | null;
  backup_units?: number | null;
  requires_supervisor?: number | boolean | null;
  caution_text?: string | null;
};

/**
 * Returns a new draft with run-card defaults applied. Does NOT mutate
 * the input. Caller is responsible for using the merged values when
 * inserting into calls_for_service.
 */
export function mergeRunCard(db: Database.Database, draft: CallDraft): { draft: CallDraft; card: RunCard | null } {
  const card = getRunCard(db, draft.incident_type);
  if (!card) return { draft, card: null };

  let cardFlags: string[] = [];
  try { cardFlags = JSON.parse(card.flags || '[]'); } catch { /* ignore */ }

  const merged: CallDraft = {
    incident_type: draft.incident_type,
    priority: elevatePriority(draft.priority, card.priority),
    flags: (draft.flags && draft.flags.length > 0) ? draft.flags : cardFlags,
    min_units: draft.min_units ?? card.min_units,
    backup_units: draft.backup_units ?? card.backup_units,
    requires_supervisor: draft.requires_supervisor != null
      ? (draft.requires_supervisor ? 1 : 0)
      : (card.requires_supervisor ?? 0),
    caution_text: draft.caution_text ?? card.caution_text,
  };
  return { draft: merged, card };
}
