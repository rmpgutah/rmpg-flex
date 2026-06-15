/** Status + warning for a human-confirm action, given whether the authoritative
 *  vehicle record/sighting actually persisted. Keeps the "confirmed" promise
 *  honest: a failed write becomes 'confirmed_unlinked' (free-text — no migration)
 *  so it is visibly distinct from a real confirmation. */
export function confirmReviewStatus(persisted: boolean): 'confirmed' | 'confirmed_unlinked' {
  return persisted ? 'confirmed' : 'confirmed_unlinked';
}

export function confirmWarning(persisted: boolean): string | undefined {
  return persisted ? undefined : 'Vehicle record or sighting could not be fully linked — review and retry.';
}
