// Configurable linkage option lists for dispatch call-linkage dropdowns.
// These hardcoded DEFAULTS are the runtime fallback — they guarantee dropdowns
// are never empty even if /api/dispatch/link-options is unreachable or unseeded.
// Admin DB rows (link_options table) are merged over these via mergeLinkOptions.
// Keep VALUES in sync with migrations/0104_link_options.sql seed.

export type LinkCategory = 'person_role' | 'vehicle_role' | 'caller_relationship' | 'business_role';

export interface LinkOption {
  value: string;
  label: string;
  sort_order?: number;
  is_active?: number | null; // 1 active, 0/null hidden (DB rows only)
}

export const DEFAULT_LINK_OPTIONS: Record<LinkCategory, LinkOption[]> = {
  person_role: [
    { value: 'suspect', label: 'Suspect', sort_order: 10, is_active: 1 },
    { value: 'victim', label: 'Victim', sort_order: 20, is_active: 1 },
    { value: 'witness', label: 'Witness', sort_order: 30, is_active: 1 },
    { value: 'reporting_party', label: 'Reporting Party', sort_order: 40, is_active: 1 },
    { value: 'involved', label: 'Involved', sort_order: 50, is_active: 1 },
    { value: 'complainant', label: 'Complainant', sort_order: 60, is_active: 1 },
    { value: 'serve_recipient', label: 'Serve Recipient', sort_order: 70, is_active: 1 },
    { value: 'serve_recipient_agent', label: 'Serve Recipient Agent', sort_order: 80, is_active: 1 },
    { value: 'registered_agent', label: 'Registered Agent', sort_order: 90, is_active: 1 },
    { value: 'authorized_agent', label: 'Authorized Agent', sort_order: 100, is_active: 1 },
    { value: 'plaintiff', label: 'Plaintiff', sort_order: 110, is_active: 1 },
    { value: 'defendant', label: 'Defendant', sort_order: 120, is_active: 1 },
    { value: 'attorney', label: 'Attorney', sort_order: 130, is_active: 1 },
    { value: 'process_server', label: 'Process Server', sort_order: 140, is_active: 1 },
    { value: 'client_contact', label: 'Client Contact', sort_order: 150, is_active: 1 },
    { value: 'mentioned', label: 'Mentioned', sort_order: 160, is_active: 1 },
    { value: 'other', label: 'Other', sort_order: 170, is_active: 1 },
  ],
  vehicle_role: [
    { value: 'suspect_vehicle', label: 'Suspect Vehicle', sort_order: 10, is_active: 1 },
    { value: 'victim_vehicle', label: 'Victim Vehicle', sort_order: 20, is_active: 1 },
    { value: 'witness_vehicle', label: 'Witness Vehicle', sort_order: 30, is_active: 1 },
    { value: 'involved', label: 'Involved', sort_order: 40, is_active: 1 },
    { value: 'evidence', label: 'Evidence', sort_order: 50, is_active: 1 },
    { value: 'towed', label: 'Towed', sort_order: 60, is_active: 1 },
    { value: 'recovered', label: 'Recovered', sort_order: 70, is_active: 1 },
    { value: 'other', label: 'Other', sort_order: 80, is_active: 1 },
  ],
  caller_relationship: [
    { value: 'employee', label: 'Employee', sort_order: 10, is_active: 1 },
    { value: 'victim', label: 'Victim', sort_order: 20, is_active: 1 },
    { value: 'witness', label: 'Witness', sort_order: 30, is_active: 1 },
    { value: 'complainant', label: 'Complainant', sort_order: 40, is_active: 1 },
    { value: 'management', label: 'Management', sort_order: 50, is_active: 1 },
    { value: 'alarm_company', label: 'Alarm Company', sort_order: 60, is_active: 1 },
    { value: 'officer', label: 'Officer', sort_order: 70, is_active: 1 },
    { value: 'anonymous', label: 'Anonymous', sort_order: 80, is_active: 1 },
    { value: 'registered_agent', label: 'Registered Agent', sort_order: 90, is_active: 1 },
    { value: 'attorney', label: 'Attorney', sort_order: 100, is_active: 1 },
    { value: 'plaintiff', label: 'Plaintiff', sort_order: 110, is_active: 1 },
    { value: 'defendant', label: 'Defendant', sort_order: 120, is_active: 1 },
    { value: 'property_manager', label: 'Property Manager', sort_order: 130, is_active: 1 },
    { value: 'tenant', label: 'Tenant', sort_order: 140, is_active: 1 },
    { value: 'client', label: 'Client', sort_order: 150, is_active: 1 },
    { value: 'guard_on_duty', label: 'Guard On Duty', sort_order: 160, is_active: 1 },
    { value: 'third_party', label: 'Third Party', sort_order: 170, is_active: 1 },
    { value: 'automated_system', label: 'Automated System', sort_order: 180, is_active: 1 },
    { value: 'neighbor', label: 'Neighbor', sort_order: 190, is_active: 1 },
    { value: 'family_member', label: 'Family Member', sort_order: 200, is_active: 1 },
    { value: 'other', label: 'Other', sort_order: 210, is_active: 1 },
  ],
  business_role: [
    { value: 'served_business', label: 'Served Business', sort_order: 10, is_active: 1 },
    { value: 'client_org', label: 'Client Organization', sort_order: 20, is_active: 1 },
    { value: 'alarm_company', label: 'Alarm Company', sort_order: 30, is_active: 1 },
    { value: 'property', label: 'Property', sort_order: 40, is_active: 1 },
    { value: 'employer', label: 'Employer', sort_order: 50, is_active: 1 },
    { value: 'registered_agent_entity', label: 'Registered Agent Entity', sort_order: 60, is_active: 1 },
    { value: 'involved', label: 'Involved', sort_order: 70, is_active: 1 },
    { value: 'other', label: 'Other', sort_order: 80, is_active: 1 },
  ],
};

/**
 * Merge admin DB rows over the hardcoded defaults for one category.
 * - DB row matching an existing value → overrides label/sort_order; is_active=0 hides it.
 * - DB row with a new value → appended as a custom option.
 * - Result sorted by sort_order then label. Never empty if defaults exist.
 */
export function mergeLinkOptions(category: LinkCategory, dbRows: LinkOption[]): LinkOption[] {
  const byValue = new Map<string, LinkOption>();
  for (const d of DEFAULT_LINK_OPTIONS[category]) byValue.set(d.value, { ...d, is_active: 1 });
  for (const r of dbRows) {
    if (r.is_active === 0 || r.is_active === null) { byValue.delete(r.value); continue; }
    const existing = byValue.get(r.value);
    byValue.set(r.value, {
      value: r.value,
      label: r.label || existing?.label || r.value,
      sort_order: r.sort_order ?? existing?.sort_order ?? 100,
      is_active: 1,
    });
  }
  return [...byValue.values()].sort(
    (a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.label.localeCompare(b.label),
  );
}
