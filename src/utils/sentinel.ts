// Sentinel-string guard for live D1 text columns.
//
// Live D1 stores literal "None"/"N/A"/"0"/"--" in flag and free-text columns
// instead of NULL (see the [[project-sentinel-none-strings]] memory). A naive
// truthiness check (`if (row.gang_affiliation)`) then fires false positives —
// e.g. a bogus officer-safety "gang affiliation noted" alert on a subject with
// no flags, or the AI dispatcher reading "Insurance None." back over the air.
// isFlagSet() treats those sentinels as absent. This is the CANONICAL home —
// import it rather than re-deriving the set per module.

export const FLAG_ABSENT = new Set(
  ['', 'none', 'n/a', 'na', '0', 'false', 'no', 'null', 'undefined', '--'],
);

/** True when a DB value is a REAL value — not NULL and not a sentinel placeholder. */
export function isFlagSet(v: unknown): boolean {
  return v != null && !FLAG_ABSENT.has(String(v).trim().toLowerCase());
}
