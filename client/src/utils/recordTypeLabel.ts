// ============================================================
// recordTypeLabel — the MANDATORY plain-language formatter for a
// record's type. Any record-type code, anywhere it is output to a
// human (lists, badges, the Connections graph, record PDFs), must
// pass through this so a raw code like `field_interview` or
// `FIELD_INTERVIEW` never reaches the screen or a printed record.
// ============================================================
//
// Two layers:
//   1. EXPLICIT map — for types whose nice form isn't just a
//      title-cased code (abbreviations, "Call for Service", etc.).
//   2. HUMANIZE fallback — split a snake_case / kebab-case / spaced
//      code into Title-Cased words. This is the guarantee: even a
//      brand-new, unmapped type renders plain rather than raw.
//
// Keep this dependency-free (no lucide / React) so it can be imported
// by PDF generators and any non-UI module without pulling the icon
// registry. The icon/color registry (utils/recordLinks.ts) delegates
// its label lookup here so the two never drift.

const EXPLICIT: Record<string, string> = {
  person: 'Person',
  vehicle: 'Vehicle',
  property: 'Property',
  business: 'Business',
  evidence: 'Evidence',
  incident: 'Incident',
  case: 'Case',
  warrant: 'Warrant',
  citation: 'Citation',
  arrest: 'Arrest',
  field_interview: 'Field Interview',
  trespass_order: 'Trespass Order',
  serve_job: 'Serve Job',
  serve: 'Serve Job',
  call: 'Call for Service',
  calls_for_service: 'Call for Service',
  cfs: 'Call for Service',
  report: 'Supplemental Report',
  supplemental_report: 'Supplemental Report',
  dl: 'Driver License',
  dl_record: 'Driver License',
};

/** Title-case a snake_case / kebab-case / spaced token: "field_interview" → "Field Interview". */
function humanize(code: string): string {
  return code
    .trim()
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Plain-language label for ANY record type. Never returns a raw code.
 * Empty/nullish → "Record" (a record always has a human-readable type).
 */
export function recordTypeLabel(type: string | null | undefined): string {
  if (type == null) return 'Record';
  const key = String(type).trim().toLowerCase();
  if (key === '') return 'Record';
  return EXPLICIT[key] ?? humanize(key) ?? 'Record';
}
