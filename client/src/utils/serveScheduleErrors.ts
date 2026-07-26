// Shared error translation for PATCH /serve-intake/schedule/:slotId
// (src/routes/serveIntake.ts). That route returns 409 with a bare
// `{error:'overlap'|'stale'}` code — apiFetch's thrown Error.message is
// literally that code with no context, so a drag-drop conflict surfaced
// the raw word "overlap"/"stale" to the operator. Both call sites (the
// unified Scheduler's agendaMutations.ts and ServeSchedulerPanel's direct
// drag-drop) hit this same endpoint, so the translation lives here once.

/** Rewrite a serve-schedule PATCH error into an operator-actionable message.
 *  Returns the ORIGINAL error unchanged when it isn't one of the two known
 *  409 codes (e.g. network failure, 403, 500) so nothing else is masked. */
/** A slot the server says would collide with the attempted move. Shape mirrors
 *  the `conflicts` array in the 409 body from PATCH /serve-intake/schedule/:id. */
export interface ScheduleConflict {
  id: number;
  scheduled_date: string;
  window_start: string;
  window_end: string;
  recipient_name?: string | null;
  case_number?: string | null;
}

/** Returns the conflicting slots when `err` is the overlap 409, else null.
 *  Null means "not an overlap" — the caller should treat the error normally.
 *  An empty array is still a conflict (server said overlap but named nothing),
 *  so callers must check `!== null` rather than truthiness of `.length`. */
export function extractOverlapConflicts(err: unknown): ScheduleConflict[] | null {
  const e = err as { status?: number; payload?: { error?: string; conflicts?: ScheduleConflict[] } };
  if (e?.status !== 409 || e.payload?.error !== 'overlap') return null;
  return Array.isArray(e.payload.conflicts) ? e.payload.conflicts : [];
}

/** Operator-facing one-liner naming what the move would double-book. */
export function describeConflicts(conflicts: ScheduleConflict[]): string {
  if (conflicts.length === 0) {
    return 'This officer already has an attempt scheduled in that window.';
  }
  const named = conflicts.slice(0, 3).map((c) => {
    const who = c.recipient_name?.trim() || c.case_number?.trim() || `slot #${c.id}`;
    return `${who} (${c.window_start}–${c.window_end})`;
  });
  const rest = conflicts.length - named.length;
  return `Already booked: ${named.join(', ')}${rest > 0 ? ` +${rest} more` : ''}.`;
}

export function describeServeScheduleError(err: unknown): Error {
  const e = err as Error & { status?: number; payload?: { error?: string } };
  if (e?.status === 409 && e.payload?.error === 'overlap') {
    return new Error('That time conflicts with another scheduled attempt for this officer — pick a different slot or officer.');
  }
  if (e?.status === 409 && e.payload?.error === 'stale') {
    return new Error('This item was changed by someone else — refresh the page and try again.');
  }
  return err instanceof Error ? err : new Error(String(err));
}
