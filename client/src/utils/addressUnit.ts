// ============================================================
// composeAddressUnit — fold an apartment/unit number into a
// single-line address string at submit time.
//
// Used by forms whose address is stored as ONE string column
// (call location, client address, vehicle owner, citation
// subject, etc.) — the Apt/Unit input is a transient entry aid,
// not a separate column. Forms with a structured address block
// (persons/users/officers/serve/properties) use a real
// address_2 column instead.
// ============================================================

/** Designator prefixes that mean the operator already typed a unit label. */
const UNIT_DESIGNATOR = /^(apt|apartment|unit|ste|suite|#|bldg|building|trlr|lot|rm|room|fl|floor|spc|space|box)\b/i;

/**
 * Returns `address` with the unit appended (", Apt 4B"). A unit that
 * already starts with a designator ("Unit 12", "#305") is appended
 * verbatim; a bare value ("4B") gets an "Apt " prefix. Empty unit or
 * empty address → address unchanged (a unit with no street is meaningless).
 */
export function composeAddressUnit(address: string, unit: string): string {
  const addr = (address || '').trim();
  const u = (unit || '').trim();
  if (!addr || !u) return addr;
  const label = UNIT_DESIGNATOR.test(u) ? u : `Apt ${u}`;
  // Don't double-append if the operator already typed the unit into the
  // address line itself.
  if (addr.toLowerCase().includes(label.toLowerCase())) return addr;
  return `${addr}, ${label}`;
}
