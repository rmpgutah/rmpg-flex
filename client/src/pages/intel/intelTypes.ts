// Shared intel search types + pivot logic. Lifted out of IntelSearchPage so
// the portal (rail, dashboard, search) and GlobalSearch share one source of
// truth without importing a page component.

export interface IntelHit {
  type: string; id: number; label: string; snippet: string;
  flags: string[]; score: number;
  cluster?: { canonical_person_id: number | null; pending_suggestions: number };
}

export const TYPE_LABELS: Record<string, string> = {
  person: 'PERSONS', vehicle: 'VEHICLES', property: 'PROPERTIES', case: 'CASES',
  incident: 'INCIDENTS', call: 'CALLS FOR SERVICE', warrant: 'WARRANTS',
  citation: 'CITATIONS', field_interview: 'FIELD INTERVIEWS',
  trespass_order: 'TRESPASS ORDERS', evidence: 'EVIDENCE',
};

// Where a result row navigates on click — mirrors record-page routes.
export function recordPath(hit: { type: string; id: number }): string {
  switch (hit.type) {
    case 'person': return `/intel/person/${hit.id}`;
    case 'vehicle': return `/records?tab=vehicles&id=${hit.id}`;
    case 'warrant': return `/warrants?id=${hit.id}`;
    case 'case': return `/cases?id=${hit.id}`;
    default: return `/connections?type=${hit.type}&id=${hit.id}`;
  }
}
