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
