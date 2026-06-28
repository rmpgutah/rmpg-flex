// ============================================================
// RMPG Flex — Connections timeline pure helpers (Intel Wave 2).
// Turns the current graph's node set into a merged chronological
// stream. Pure (no D1/Hono) — tested in tests/connectionsTimeline.test.ts.
// mergeTimeline is reused from intelDossier.ts.
// ============================================================
import type { TimelineEvent } from './intelDossier';

export interface NodeRef { type: string; id: number; }

/** Parse "person:1,incident:5" → refs. Drops junk, dedups, caps. */
export function parseNodeRefs(param: string, cap = 60): NodeRef[] {
  const out: NodeRef[] = [];
  const seen = new Set<string>();
  for (const tok of String(param || '').split(',')) {
    const [type, idStr] = tok.split(':');
    const id = Number(idStr);
    if (!type || !Number.isInteger(id) || id <= 0) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id });
    if (out.length >= cap) break;
  }
  return out;
}

const s = (v: unknown) => (v == null ? '' : String(v));

/** Map one DB row of a dated type to a TimelineEvent (or null if undated/unknown). */
export function buildTimelineEvent(type: string, row: any): TimelineEvent | null {
  switch (type) {
    case 'incident':
      return { kind: 'incident', id: row.id, date: row.occurred_date || row.created_at || null,
        title: `${s(row.incident_number)} ${s(row.incident_type)}`.trim() || `Incident #${row.id}`,
        subtitle: s(row.location_address), status: s(row.status) };
    case 'call':
      return { kind: 'call', id: row.id, date: row.created_at || null,
        title: `${row.call_number || `CFS-${row.id}`} ${s(row.incident_type)}`.trim(),
        subtitle: s(row.location_address), status: s(row.status) };
    case 'citation':
      return { kind: 'citation', id: row.id, date: row.violation_date || null,
        title: s(row.citation_number) || `CIT-${row.id}`, subtitle: s(row.violation_description), status: s(row.status) };
    case 'warrant':
      return { kind: 'warrant', id: row.id, date: row.issued_date || null,
        title: s(row.warrant_number) || `W-${row.id}`, subtitle: s(row.charge_description), status: s(row.status) };
    case 'arrest':
      return { kind: 'arrest', id: row.id, date: row.booking_date || null,
        title: s(row.full_name) || `Arrest #${row.id}`, subtitle: s(row.charges), status: s(row.status) };
    case 'field_interview':
      return { kind: 'field_interview', id: row.id, date: row.created_at || null,
        title: s(row.fi_number) || `FI-${row.id}`, subtitle: s(row.contact_reason), status: s(row.status) };
    case 'trespass_order':
      return { kind: 'trespass_order', id: row.id, date: row.effective_date || null,
        title: s(row.order_number) || `TO-${row.id}`, subtitle: s(row.location), status: s(row.status) };
    case 'case':
      return { kind: 'case', id: row.id, date: row.created_at || null,
        title: `${s(row.case_number)} ${s(row.title)}`.trim() || `Case #${row.id}`, subtitle: s(row.case_type), status: s(row.status) };
    case 'evidence':
      return { kind: 'evidence', id: row.id, date: row.created_at || null,
        title: s(row.evidence_number) || `Evidence #${row.id}`, subtitle: s(row.description), status: s(row.status) };
    case 'intel_report':
      return { kind: 'intel', id: row.id, date: row.disseminated_at || null,
        title: `${row.report_number || `INT-${row.id}`} — ${s(row.title)}`.trim(),
        subtitle: `${s(row.source_reliability) || '?'}${s(row.info_credibility) || '?'} · ${s(row.threat_level)}`,
        status: 'DISSEMINATED' };
    default:
      return null;
  }
}
