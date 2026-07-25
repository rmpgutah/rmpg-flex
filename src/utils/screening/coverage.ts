// ============================================================
// Source coverage — guards against the "empty registry reads as a
// clean result" false-clear.
// ============================================================
// Some screening sources (Utah SOR) are backed by a LOCAL table that
// only fills from an authorized feed or admin import. When that table
// is empty, a name search returns nothing — which on a sex-offender
// check looks identical to "this person is NOT a registered offender."
// That is a dangerous false negative. `coverage` lets a search response
// tell the operator WHY a result set is empty so a blank screen can
// never be mistaken for a clearance.
// ============================================================

export interface SourceCoverage {
  /** True when there is searchable data behind this source right now. */
  available: boolean;
  /** Rows currently loaded (for local-table sources). */
  rowCount?: number;
  /** Whether a feed/credential is provisioned for this source. */
  configured?: boolean;
  severity: 'ok' | 'warning';
  /** Operator-facing explanation, present only when `available` is false. */
  message?: string;
}

/**
 * Decide coverage for the Utah Sex Offender Registry from its current
 * row count and whether a data feed is provisioned. Pure — unit tested.
 */
/**
 * Coverage for a lookup that FAILED rather than one with no data.
 *
 * `sorCoverage` below answers "is there data behind this source". This answers a
 * different question with the same consequence: the query threw, so we do not
 * know the answer. Several safety lookups catch their errors and return an empty
 * collection, which is indistinguishable from "checked, nothing found" — the
 * false-clear class documented at records.ts:1148. Attaching this to the
 * response lets the caller say "could not check" instead of implying a clearance.
 *
 * `subject` names the thing that could not be checked, e.g. 'Active BOLOs'.
 */
export function lookupFailedCoverage(subject: string): SourceCoverage {
  return {
    available: false,
    severity: 'warning',
    message:
      `${subject} could not be checked — the lookup failed. This is NOT a ` +
      'clearance: it can neither confirm nor rule out a match. Retry, and ' +
      'report it if it persists.',
  };
}

/** Coverage for a lookup that ran successfully. */
export const LOOKUP_OK: SourceCoverage = { available: true, severity: 'ok' };

export function sorCoverage(rowCount: number, feedConfigured: boolean): SourceCoverage {
  if (rowCount > 0) {
    return { available: true, rowCount, configured: feedConfigured, severity: 'ok' };
  }
  return {
    available: false,
    rowCount: 0,
    configured: feedConfigured,
    severity: 'warning',
    message: feedConfigured
      ? 'Utah Sex Offender Registry feed is configured but no records have loaded yet. ' +
        'A blank result is NOT a clearance — run a feed poll (Admin → SOR) or contact Utah BCI.'
      : 'Utah Sex Offender Registry is not populated (0 records) and no data feed is provisioned. ' +
        'A blank result here is NOT a clearance — it cannot confirm or rule out registrant status. ' +
        'Provision the BCI/OffenderWatch feed or import records under Admin.',
  };
}
