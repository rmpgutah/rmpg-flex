// ============================================================
// RMPG Flex — Connection Analysis API (Cloudflare Worker port)
// ============================================================
// Graph traversal for visualizing relationships across the RMS:
// persons, vehicles, properties, cases, incidents, evidence,
// warrants, citations, arrests, field interviews, trespass orders,
// serve jobs — plus calls-for-service (CFS) and supplemental reports.
//
// Ported from legacy/server-vps/src/routes/connections.ts. Two changes
// beyond the mechanical Express→Hono / better-sqlite3→D1 (async) port:
//   1. `call` (calls_for_service) and `report` (supplemental_reports)
//      are now first-class node types. Previously calls were only ever
//      hopped THROUGH to reach incidents; now the call itself is a node,
//      so a person → call → {incident, vehicle, citation, …} fan-out is
//      visible. Reports hang off their parent incident.
//   2. Node label + metadata are fetched in ONE SELECT per node
//      (loadNode) instead of two — D1 round-trips count against the
//      Worker subrequest budget, and BFS can touch MAX_NODES nodes.
//
// Backing tables verified against live D1 (785de7ae) 2026-05-29.
// record_links.source_id/target_id are TEXT — IDs come back as strings
// and are coerced with Number() when building edges.
// ============================================================

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { getDb, query, queryFirst, execute, queryInChunks } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { cappedLikePattern, codedLike } from '../utils/searchText';
import { mergeTimeline } from '../utils/intelDossier';
import { parseNodeRefs, buildTimelineEvent } from '../utils/connectionsTimeline';
import { recordAudit } from '../utils/auditLog';
import { log } from '../utils/logger';

const connections = new Hono<Env>();

// ── Types ────────────────────────────────────────────────────

interface GNode {
  id: string;
  type: string;
  entityId: number;
  label: string;
  metadata: Record<string, any>;
  depth: number;
}
interface GEdge {
  source: string;
  target: string;
  relationship: string;
  sourceTable: string;
}
interface Connection {
  type: string;
  id: number;
  relationship: string;
  sourceTable: string;
}

// Roles allowed to read the graph / search / paths. Mirrors the legacy
// gate: everyone operational. client_viewer / contract_manager /
// human_resources are intentionally excluded.
const OPERATIONAL_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

const VALID_TYPES = [
  'person', 'vehicle', 'property', 'business', 'evidence', 'case', 'incident',
  'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order',
  'serve_job', 'call', 'report', 'intel_report', 'alpr_sighting',
  'forensic_case', 'forensic_exhibit',
];

// ── Helpers ──────────────────────────────────────────────────

// Best-effort audit row. MUST NOT throw — a failed audit write can never
// be allowed to fail the user's request.
async function audit(
  c: Context,
  action: string,
  entityType: string,
  entityId: number | string,
  details: string,
): Promise<void> {
  await recordAudit(c, {
    action,
    entityType,
    entityId: String(entityId),
    details,
    actorId: (c.get('userId') as number | undefined) ?? null,
  });
}

// ── Node loading (label + metadata in one query) ─────────────
// Returns the full metadata row AND a human-readable label derived from
// it — one SELECT per node instead of two.

// Each traversal query is independent — a missing/legacy table (or any single
// failure) must not blind the WHOLE node. A rejected Promise.all here used to
// drop every edge of that type when just one junction table was absent.
// Tuple-preserving so each batch element keeps its own row type.
async function allSettledRows<T extends readonly Promise<unknown[]>[]>(
  qs: T,
): Promise<{ -readonly [K in keyof T]: T[K] extends Promise<infer R> ? R : never }> {
  const settled = await Promise.allSettled(qs);
  return settled.map((s) => (s.status === 'fulfilled'
    ? s.value
    : ([] as unknown))) as { -readonly [K in keyof T]: T[K] extends Promise<infer R> ? R : never };
}

async function loadNode(
  db: D1Database,
  type: string,
  id: number,
): Promise<{ label: string; metadata: Record<string, any> }> {
  try {
    switch (type) {
      case 'person': {
        const p = await queryFirst<any>(db, 'SELECT first_name, last_name, dob, address, city, state, phone, flags FROM persons WHERE id = ?', id);
        return { label: p ? `${p.first_name} ${p.last_name}`.trim() : `Person #${id}`, metadata: p || {} };
      }
      case 'vehicle': {
        const v = await queryFirst<any>(db, 'SELECT plate_number, state, make, model, year, color, vin, owner_person_id, flags FROM vehicles_records WHERE id = ?', id);
        return { label: v ? `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.replace(/\s+/g, ' ').trim() : `Vehicle #${id}`, metadata: v || {} };
      }
      case 'property': {
        const pr = await queryFirst<any>(db, 'SELECT name, address, property_type, client_id FROM properties WHERE id = ?', id);
        return { label: pr ? pr.name : `Property #${id}`, metadata: pr || {} };
      }
      case 'business': {
        const b = await queryFirst<any>(db, 'SELECT name, dba_name, business_type, address, phone FROM businesses WHERE id = ?', id);
        if (!b) return { label: `Business #${id}`, metadata: {} };
        const label = b.dba_name ? `${b.name} (${b.dba_name})` : (b.name || b.address || `Business #${id}`);
        return { label, metadata: b };
      }
      case 'evidence': {
        const e = await queryFirst<any>(db, 'SELECT evidence_number, description, evidence_type, status, incident_id FROM evidence WHERE id = ?', id);
        return { label: e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() || `Evidence #${id}` : `Evidence #${id}`, metadata: e || {} };
      }
      case 'case': {
        const c = await queryFirst<any>(db, 'SELECT case_number, title, case_type, status, priority FROM cases WHERE id = ?', id);
        return { label: c ? `${c.case_number} - ${c.title}` : `Case #${id}`, metadata: c || {} };
      }
      case 'incident': {
        const i = await queryFirst<any>(db, 'SELECT incident_number, incident_type, status, priority, location_address, call_id FROM incidents WHERE id = ?', id);
        return { label: i ? `${i.incident_number || ''} ${i.incident_type}`.trim() : `Incident #${id}`, metadata: i || {} };
      }
      case 'warrant': {
        const w = await queryFirst<any>(db, 'SELECT warrant_number, status, type, offense_level, subject_person_id, charge_description FROM warrants WHERE id = ?', id);
        return { label: w ? `${w.warrant_number || `W-${id}`} (${w.status || '?'})` : `Warrant #${id}`, metadata: w || {} };
      }
      case 'citation': {
        const c = await queryFirst<any>(db, 'SELECT citation_number, type, status, person_id, vehicle_id, incident_id, call_id, violation_date, violation_description, offense_level, fine_amount FROM citations WHERE id = ?', id);
        return { label: c ? `${c.citation_number || `CIT-${id}`} (${c.status || '?'})` : `Citation #${id}`, metadata: c || {} };
      }
      case 'arrest': {
        const a = await queryFirst<any>(db, 'SELECT first_name, last_name, full_name, booking_date, charges, status, county, source_name FROM arrest_records WHERE id = ?', id);
        const nm = a ? (a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim()) : '';
        return { label: a ? `${nm || 'Arrest'} arr. ${a.booking_date || '?'}`.trim() : `Arrest #${id}`, metadata: a || {} };
      }
      case 'field_interview': {
        const f = await queryFirst<any>(db, 'SELECT fi_number, person_id, vehicle_id, location, contact_reason, contact_type, action_taken, status, associated_call_id, associated_incident_id, created_at FROM field_interviews WHERE id = ?', id);
        return { label: f ? `${f.fi_number || `FI-${id}`}${f.location ? ` @ ${f.location}` : ''}` : `FI #${id}`, metadata: f || {} };
      }
      case 'trespass_order': {
        const t = await queryFirst<any>(db, 'SELECT order_number, person_id, property_id, location, status, order_type, effective_date, expiration_date, issued_by_name, originating_call_id, originating_incident_id FROM trespass_orders WHERE id = ?', id);
        return { label: t ? `${t.order_number || `TO-${id}`} (${(t.status || 'unknown').toUpperCase()})` : `Trespass #${id}`, metadata: t || {} };
      }
      case 'serve_job': {
        const s = await queryFirst<any>(db, 'SELECT sm_job_id, officer_id, recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip, document_type, case_number, court_name, client_name, attorney_name, priority, deadline, status, attempt_count, recipient_person_id, property_id, call_id, serve_date FROM serve_queue WHERE id = ?', id);
        if (!s) return { label: `Serve #${id}`, metadata: {} };
        const ref = s.sm_job_id ? `SM-${s.sm_job_id}` : s.case_number || `SJ-${id}`;
        return { label: `${ref}${s.document_type ? ` ${s.document_type}` : ''} (${(s.status || 'pending').toUpperCase()})`, metadata: s };
      }
      case 'call': {
        const cf = await queryFirst<any>(db, 'SELECT call_number, incident_type, priority, status, location_address, property_id, case_id, created_at FROM calls_for_service WHERE id = ?', id);
        return { label: cf ? `${cf.call_number || `CFS-${id}`} ${cf.incident_type || ''} (${(cf.status || '?').toUpperCase()})`.replace(/\s+/g, ' ').trim() : `Call #${id}`, metadata: cf || {} };
      }
      case 'report': {
        const r = await queryFirst<any>(db, 'SELECT report_number, incident_id, report_type, author_id, created_at FROM supplemental_reports WHERE id = ?', id);
        return { label: r ? `${r.report_number || `SR-${id}`} (${r.report_type || 'supplemental'})` : `Report #${id}`, metadata: r || {} };
      }
      case 'intel_report': {
        const r = await queryFirst<any>(db,
          `SELECT report_number, title, source_reliability, info_credibility, handling_code, threat_level
           FROM intel_reports WHERE id = ? AND status = 'disseminated'`, id);
        if (!r) return { label: `Intel #${id}`, metadata: {} };
        const grade = (r.source_reliability && r.info_credibility) ? `${r.source_reliability}${r.info_credibility}` : '';
        return {
          label: `${r.report_number || `INT-${id}`} — ${r.title || ''}`.trim(),
          metadata: { grade, threat_level: r.threat_level || 'low', handling_code: r.handling_code || '', intel: true },
        };
      }
      case 'alpr_sighting': {
        // Positive id = alpr_captures row; negative id = vehicle_sightings
        // row (negated to avoid colliding with alpr_captures' own
        // independent, overlapping AUTOINCREMENT sequence — both tables
        // start at 1, so without this encoding an alpr_sighting node could
        // silently resolve to the WRONG table's row of the same id).
        if (id > 0) {
          const cap = await queryFirst<any>(db, 'SELECT plate, state, location_text, lat, lng, created_at FROM alpr_captures WHERE id = ?', id);
          return {
            label: cap ? `${cap.plate || '?'} (${cap.state || '?'}) — ${cap.location_text || 'unknown location'}` : `ALPR Sighting #${id}`,
            metadata: cap || {},
          };
        }
        const sighting = await queryFirst<any>(db, 'SELECT plate, state, location_text, lat, lng, created_at FROM vehicle_sightings WHERE id = ?', -id);
        return {
          label: sighting ? `${sighting.plate || '?'} (${sighting.state || '?'}) — ${sighting.location_text || 'unknown location'}` : `ALPR Sighting #${-id}`,
          metadata: sighting || {},
        };
      }
      case 'forensic_case': {
        const fc = await queryFirst<any>(db, 'SELECT lab_number, title, status, received_date FROM forensic_cases WHERE id = ?', id);
        return { label: fc ? `${fc.lab_number || ''} — ${fc.title || ''}`.trim() || `Forensic Case #${id}` : `Forensic Case #${id}`, metadata: fc || {} };
      }
      case 'forensic_exhibit': {
        const fe = await queryFirst<any>(db, 'SELECT exhibit_number, description, disposition FROM forensic_exhibits WHERE id = ?', id);
        return { label: fe ? `${fe.exhibit_number || ''} — ${fe.description || ''}`.trim() || `Exhibit #${id}` : `Exhibit #${id}`, metadata: fe || {} };
      }
      default:
        return { label: `${type} #${id}`, metadata: {} };
    }
  } catch (err) {
    log.warn('Connections loadNode ${type}#${id} error', { error: err instanceof Error ? err.message : String(err) });
    return { label: `${type} #${id}`, metadata: {} };
  }
}

// ── Connection Discovery ─────────────────────────────────────
// Returns every record directly connected (1 hop) to (type, id).
// Each query block is independently try/caught so column drift on one
// table degrades to "fewer edges", never an empty graph.

async function findConnections(db: D1Database, type: string, id: number): Promise<Connection[]> {
  const results: Connection[] = [];

  // helper: push rows mapped to a connection
  const add = (type: string, id: number, relationship: string, sourceTable: string) =>
    results.push({ type, id, relationship, sourceTable });

  // 1. record_links (bidirectional, generic manual links). source_id /
  //    target_id are TEXT in D1 — bind as string, read back with Number.
  try {
    const links = await query<any>(
      db,
      `SELECT source_type, source_id, target_type, target_id, relationship
       FROM record_links
       WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
       LIMIT 1000`,
      type, String(id), type, String(id),
    );
    for (const link of links) {
      const isSource = link.source_type === type && Number(link.source_id) === id;
      add(
        isSource ? link.target_type : link.source_type,
        Number(isSource ? link.target_id : link.source_id),
        link.relationship,
        'record_links',
      );
    }
  } catch (err) {
    log.warn('Connections record_links query error', { error: err instanceof Error ? err.message : String(err) });
  }

  // forensic_case_entity_links — same bidirectional pattern as record_links
  // above, but a separate table (shipped in the forensics government-
  // standard PR) rather than the generic cross-link table.
  try {
    for (const r of await query<any>(db,
      `SELECT forensic_case_id, entity_type, entity_id, relationship FROM forensic_case_entity_links
       WHERE (entity_type = ? AND entity_id = ?)`, type, id,
    )) add('forensic_case', r.forensic_case_id, r.relationship || 'linked', 'forensic_case_entity_links');

    if (type === 'forensic_case') {
      for (const r of await query<any>(db,
        `SELECT entity_type, entity_id, relationship FROM forensic_case_entity_links WHERE forensic_case_id = ?`, id,
      )) add(r.entity_type, r.entity_id, r.relationship || 'linked', 'forensic_case_entity_links');
    }
  } catch (err) {
    log.warn('Connections forensic_case_entity_links error', { error: err instanceof Error ? err.message : String(err) });
  }

  // 2. Type-specific junction / FK traversal — parallelized for performance.
  // D1 subrequests are async network calls; running them concurrently cuts
  // the wall-clock time from ~12 sequential round-trips to ~1 for most nodes.
  try {
    switch (type) {
      case 'person': {
        const personQueries = await allSettledRows([
          query<any>(db, 'SELECT incident_id, role FROM incident_persons WHERE person_id = ?', id),
          query<any>(db, 'SELECT call_id, role FROM call_persons WHERE person_id = ?', id),
          query<any>(db, 'SELECT id FROM vehicles_records WHERE owner_person_id = ?', id),
          query<any>(db, 'SELECT case_id FROM case_person_links WHERE person_id = ?', id),
          query<any>(db, 'SELECT cp.relationship, p.id AS property_id FROM client_persons cp JOIN properties p ON p.client_id = cp.client_id WHERE cp.person_id = ? LIMIT 1000', id),
          query<any>(db, 'SELECT id, status FROM warrants WHERE subject_person_id = ?', id),
          query<any>(db, 'SELECT id, status FROM citations WHERE person_id = ?', id),
          query<any>(db, "SELECT arrest_record_id FROM arrest_cross_links WHERE linked_type = 'person' AND linked_id = ?", id),
          query<any>(db, 'SELECT id FROM field_interviews WHERE person_id = ?', id),
          query<any>(db, 'SELECT id FROM trespass_orders WHERE person_id = ?', id),
          query<any>(db, 'SELECT id FROM serve_queue WHERE recipient_person_id = ?', id),
        ]);
        for (const r of personQueries[0]) add('incident', r.incident_id, r.role || 'involved', 'incident_persons');
        for (const r of personQueries[1]) if (r.call_id) add('call', r.call_id, r.role || 'subject', 'call_persons');
        for (const r of personQueries[2]) add('vehicle', r.id, 'owner', 'vehicles_records');
        for (const r of personQueries[3]) add('case', r.case_id, 'linked', 'case_person_links');
        for (const r of personQueries[4]) add('property', r.property_id, r.relationship || 'client', 'client_persons');
        for (const r of personQueries[5]) add('warrant', r.id, `warrant_${(r.status || '').toLowerCase()}`, 'warrants');
        for (const r of personQueries[6]) add('citation', r.id, `citation_${(r.status || '').toLowerCase()}`, 'citations');
        for (const r of personQueries[7]) add('arrest', r.arrest_record_id, 'arrested', 'arrest_cross_links');
        for (const r of personQueries[8]) add('field_interview', r.id, 'fi_contact', 'field_interviews');
        for (const r of personQueries[9]) add('trespass_order', r.id, 'trespassed_from', 'trespass_orders');
        for (const r of personQueries[10]) add('serve_job', r.id, 'serve_recipient', 'serve_queue');

        // ── Derived person↔person edges (Palantir Phase 3) ──
        // Labeled semantic links so analysts see WHY two people connect
        // without hopping through an event node. Each rule is capped and
        // guarded; sentinel strings ("None"/"N/A"/"0") never match.
        // 2a. Confirmed linked identities (entity resolution, mig 0098).
        try {
          for (const r of await query<any>(db,
            `SELECT person_id, canonical_person_id FROM person_canonical
             WHERE person_id = ? OR canonical_person_id = ?
                OR canonical_person_id = (SELECT canonical_person_id FROM person_canonical WHERE person_id = ?)
             LIMIT 10`, id, id, id)) {
            const other = r.person_id === id ? r.canonical_person_id : r.person_id;
            if (other !== id) add('person', other, 'linked_identity', 'person_canonical');
          }
        } catch (err) { log.warn('Connections linked_identity edges error', { error: err instanceof Error ? err.message : String(err) }); }
        // 2b. Shared address (exact, sentinel-guarded).
        try {
          for (const r of await query<any>(db,
            `SELECT p2.id FROM persons p1 JOIN persons p2
               ON p2.address = p1.address AND p2.id != p1.id
             WHERE p1.id = ? AND p1.address IS NOT NULL AND TRIM(p1.address) != ''
               AND LOWER(TRIM(p1.address)) NOT IN ('none','n/a','na','null','0','unknown')
             LIMIT 8`, id))
            add('person', r.id, 'shares_address', 'persons');
        } catch (err) { log.warn('Connections shares_address edges error', { error: err instanceof Error ? err.message : String(err) }); }
        // 2c. Shared phone (exact, sentinel-guarded).
        try {
          for (const r of await query<any>(db,
            `SELECT p2.id FROM persons p1 JOIN persons p2
               ON p2.phone = p1.phone AND p2.id != p1.id
             WHERE p1.id = ? AND p1.phone IS NOT NULL AND TRIM(p1.phone) != ''
               AND LOWER(TRIM(p1.phone)) NOT IN ('none','n/a','na','null','0','unknown')
             LIMIT 8`, id))
            add('person', r.id, 'shares_phone', 'persons');
        } catch (err) { log.warn('Connections shares_phone edges error', { error: err instanceof Error ? err.message : String(err) }); }
        break;
      }

      case 'vehicle': {
        const idStr = String(id);
        const vehicleQueries = await allSettledRows([
          query<any>(db, 'SELECT incident_id, role FROM incident_vehicles WHERE vehicle_id = ?', id),
          query<any>(db, 'SELECT call_id, role FROM call_vehicles WHERE vehicle_id = ?', id),
          queryFirst<any>(db, 'SELECT owner_person_id FROM vehicles_records WHERE id = ?', id),
          query<any>(db, 'SELECT id, status FROM citations WHERE vehicle_id = ?', id),
          query<any>(db, 'SELECT id FROM field_interviews WHERE vehicle_id = ?', id),
          query<any>(db, 'SELECT business_id, relationship FROM business_vehicles WHERE vehicle_id = ?', id),
          query<any>(db,
            `SELECT id FROM alpr_captures WHERE (
               vehicle_record_ids = '[' || ? || ']'
               OR vehicle_record_ids LIKE '[' || ? || ',%'
               OR vehicle_record_ids LIKE '%,' || ? || ']'
               OR vehicle_record_ids LIKE '%,' || ? || ',%'
             ) ORDER BY created_at DESC LIMIT 20`,
            idStr, idStr, idStr, idStr,
          ),
          query<any>(db, 'SELECT id FROM vehicle_sightings WHERE vehicle_id = ? ORDER BY created_at DESC LIMIT 20', id),
        ]);
        for (const r of vehicleQueries[0]) add('incident', r.incident_id, r.role || 'involved', 'incident_vehicles');
        for (const r of vehicleQueries[1]) if (r.call_id) add('call', r.call_id, r.role || 'involved', 'call_vehicles');
        const v = vehicleQueries[2];
        if (v?.owner_person_id) add('person', v.owner_person_id, 'owner', 'vehicles_records');
        for (const r of vehicleQueries[3]) add('citation', r.id, `citation_${(r.status || '').toLowerCase()}`, 'citations');
        for (const r of vehicleQueries[4]) add('field_interview', r.id, 'fi_vehicle', 'field_interviews');
        for (const r of vehicleQueries[5]) add('business', r.business_id, r.relationship || 'business_vehicle', 'business_vehicles');
        for (const r of vehicleQueries[6]) add('alpr_sighting', r.id, 'alpr_capture', 'alpr_captures');
        for (const r of vehicleQueries[7]) add('alpr_sighting', -r.id, 'alpr_capture', 'vehicle_sightings');
        break;
      }

      case 'incident': {
        const incidentQueries = await allSettledRows([
          query<any>(db, 'SELECT person_id, role FROM incident_persons WHERE incident_id = ?', id),
          query<any>(db, 'SELECT vehicle_id, role FROM incident_vehicles WHERE incident_id = ?', id),
          query<any>(db, 'SELECT id FROM evidence WHERE incident_id = ?', id),
          queryFirst<any>(db, 'SELECT property_id, call_id FROM incidents WHERE id = ?', id),
          query<any>(db, 'SELECT case_id FROM case_incident_links WHERE incident_id = ?', id),
          query<any>(db, 'SELECT id, report_type FROM supplemental_reports WHERE incident_id = ?', id),
          query<any>(db, 'SELECT id, status FROM citations WHERE incident_id = ?', id),
          query<any>(db, 'SELECT linked_type, linked_id FROM incident_links WHERE incident_id = ?', id),
          query<any>(db, 'SELECT id FROM alpr_captures WHERE incident_id = ? ORDER BY created_at DESC LIMIT 20', id),
        ]);
        for (const r of incidentQueries[0]) add('person', r.person_id, r.role || 'involved', 'incident_persons');
        for (const r of incidentQueries[1]) add('vehicle', r.vehicle_id, r.role || 'involved', 'incident_vehicles');
        for (const r of incidentQueries[2]) add('evidence', r.id, 'collected_from', 'evidence');
        const inc = incidentQueries[3];
        if (inc?.property_id) add('property', inc.property_id, 'location', 'incidents');
        if (inc?.call_id) add('call', inc.call_id, 'originating_call', 'incidents');
        for (const r of incidentQueries[4]) add('case', r.case_id, 'linked', 'case_incident_links');
        for (const r of incidentQueries[5]) add('report', r.id, r.report_type || 'supplemental', 'supplemental_reports');
        for (const r of incidentQueries[6]) add('citation', r.id, `citation_${(r.status || '').toLowerCase()}`, 'citations');
        for (const r of incidentQueries[7]) if (r.linked_type && r.linked_id) add(r.linked_type, Number(r.linked_id), 'linked', 'incident_links');
        for (const r of incidentQueries[8]) add('alpr_sighting', r.id, 'alpr_capture', 'alpr_captures');
        break;
      }

      case 'call': {
        const callQueries = await allSettledRows([
          query<any>(db, 'SELECT person_id, role FROM call_persons WHERE call_id = ?', id),
          query<any>(db, 'SELECT vehicle_id, role FROM call_vehicles WHERE call_id = ?', id),
          query<any>(db, 'SELECT id FROM incidents WHERE call_id = ?', id),
          queryFirst<any>(db, 'SELECT property_id, case_id FROM calls_for_service WHERE id = ?', id),
          query<any>(db, 'SELECT id FROM citations WHERE call_id = ?', id),
          query<any>(db, 'SELECT id FROM field_interviews WHERE associated_call_id = ?', id),
          query<any>(db, 'SELECT id FROM trespass_orders WHERE originating_call_id = ?', id),
          query<any>(db, 'SELECT id FROM serve_queue WHERE call_id = ?', id),
          query<any>(db, 'SELECT business_id, role FROM call_businesses WHERE call_id = ?', id),
          query<any>(db, 'SELECT id FROM alpr_captures WHERE call_id = ? ORDER BY created_at DESC LIMIT 20', id),
        ]);
        for (const r of callQueries[0]) add('person', r.person_id, r.role || 'subject', 'call_persons');
        for (const r of callQueries[1]) add('vehicle', r.vehicle_id, r.role || 'involved', 'call_vehicles');
        for (const r of callQueries[2]) add('incident', r.id, 'incident_from_call', 'incidents');
        const cf = callQueries[3];
        if (cf?.property_id) add('property', cf.property_id, 'location', 'calls_for_service');
        if (cf?.case_id) add('case', cf.case_id, 'linked', 'calls_for_service');
        for (const r of callQueries[4]) add('citation', r.id, 'cited_on_call', 'citations');
        for (const r of callQueries[5]) add('field_interview', r.id, 'fi_on_call', 'field_interviews');
        for (const r of callQueries[6]) add('trespass_order', r.id, 'order_from_call', 'trespass_orders');
        for (const r of callQueries[7]) add('serve_job', r.id, 'serve_from_call', 'serve_queue');
        for (const r of callQueries[8]) add('business', r.business_id, r.role || 'involved', 'call_businesses');
        for (const r of callQueries[9]) add('alpr_sighting', r.id, 'alpr_capture', 'alpr_captures');
        break;
      }

      case 'report': {
        const r = await queryFirst<any>(db, 'SELECT incident_id FROM supplemental_reports WHERE id = ?', id);
        if (r?.incident_id) add('incident', r.incident_id, 'supplements', 'supplemental_reports');
        break;
      }

      case 'case': {
        for (const r of await query<any>(db, 'SELECT person_id FROM case_person_links WHERE case_id = ?', id))
          add('person', r.person_id, 'linked', 'case_person_links');
        for (const r of await query<any>(db, 'SELECT incident_id FROM case_incident_links WHERE case_id = ?', id))
          add('incident', r.incident_id, 'linked', 'case_incident_links');
        for (const r of await query<any>(db, 'SELECT evidence_id FROM case_evidence_links WHERE case_id = ?', id))
          add('evidence', r.evidence_id, 'linked', 'case_evidence_links');
        for (const r of await query<any>(db, 'SELECT id FROM calls_for_service WHERE case_id = ?', id))
          add('call', r.id, 'linked', 'calls_for_service');
        break;
      }

      case 'property': {
        for (const r of await query<any>(db, 'SELECT id FROM incidents WHERE property_id = ?', id))
          add('incident', r.id, 'location', 'incidents');
        const prop = await queryFirst<any>(db, 'SELECT client_id FROM properties WHERE id = ?', id);
        if (prop?.client_id) {
          for (const r of await query<any>(db, 'SELECT person_id, relationship FROM client_persons WHERE client_id = ?', prop.client_id))
            add('person', r.person_id, r.relationship || 'client', 'client_persons');
        }
        for (const r of await query<any>(db, 'SELECT id FROM trespass_orders WHERE property_id = ?', id))
          add('trespass_order', r.id, 'trespass_on_location', 'trespass_orders');
        for (const r of await query<any>(db, 'SELECT id FROM serve_queue WHERE property_id = ?', id))
          add('serve_job', r.id, 'serve_location', 'serve_queue');
        for (const r of await query<any>(db, 'SELECT id FROM calls_for_service WHERE property_id = ?', id))
          add('call', r.id, 'call_at_location', 'calls_for_service');
        break;
      }

      case 'business': {
        for (const r of await query<any>(db, 'SELECT vehicle_id, relationship FROM business_vehicles WHERE business_id = ?', id))
          add('vehicle', r.vehicle_id, r.relationship || 'business_vehicle', 'business_vehicles');
        for (const r of await query<any>(db, 'SELECT call_id, role FROM call_businesses WHERE business_id = ?', id))
          add('call', r.call_id, r.role || 'involved', 'call_businesses');
        break;
      }

      case 'evidence': {
        const ev = await queryFirst<any>(db, 'SELECT incident_id FROM evidence WHERE id = ?', id);
        if (ev?.incident_id) add('incident', ev.incident_id, 'collected_from', 'evidence');
        for (const r of await query<any>(db, 'SELECT case_id FROM case_evidence_links WHERE evidence_id = ?', id))
          add('case', r.case_id, 'linked', 'case_evidence_links');
        break;
      }

      case 'warrant': {
        const w = await queryFirst<any>(db, 'SELECT subject_person_id FROM warrants WHERE id = ?', id);
        const pid = w?.subject_person_id;
        if (pid) add('person', pid, 'subject', 'warrants');
        break;
      }

      case 'citation': {
        const c = await queryFirst<any>(db, 'SELECT person_id, vehicle_id, incident_id, call_id FROM citations WHERE id = ?', id);
        if (c?.person_id) add('person', c.person_id, 'subject', 'citations');
        if (c?.vehicle_id) add('vehicle', c.vehicle_id, 'cited_vehicle', 'citations');
        if (c?.incident_id) add('incident', c.incident_id, 'cited_in_incident', 'citations');
        if (c?.call_id) add('call', c.call_id, 'cited_on_call', 'citations');
        break;
      }

      case 'arrest': {
        for (const r of await query<any>(db, "SELECT linked_id FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = 'person'", id))
          add('person', r.linked_id, 'arrestee', 'arrest_cross_links');
        break;
      }

      case 'field_interview': {
        const f = await queryFirst<any>(db, 'SELECT person_id, vehicle_id, associated_call_id, associated_incident_id FROM field_interviews WHERE id = ?', id);
        if (f?.person_id) add('person', f.person_id, 'subject', 'field_interviews');
        if (f?.vehicle_id) add('vehicle', f.vehicle_id, 'fi_vehicle', 'field_interviews');
        if (f?.associated_call_id) add('call', f.associated_call_id, 'fi_on_call', 'field_interviews');
        if (f?.associated_incident_id) add('incident', f.associated_incident_id, 'fi_in_incident', 'field_interviews');
        break;
      }

      case 'trespass_order': {
        const t = await queryFirst<any>(db, 'SELECT person_id, property_id, originating_call_id, originating_incident_id FROM trespass_orders WHERE id = ?', id);
        if (t?.person_id) add('person', t.person_id, 'subject', 'trespass_orders');
        if (t?.property_id) add('property', t.property_id, 'location', 'trespass_orders');
        if (t?.originating_call_id) add('call', t.originating_call_id, 'order_from_call', 'trespass_orders');
        if (t?.originating_incident_id) add('incident', t.originating_incident_id, 'order_from_incident', 'trespass_orders');
        break;
      }

      case 'serve_job': {
        const s = await queryFirst<any>(db, 'SELECT recipient_person_id, property_id, call_id FROM serve_queue WHERE id = ?', id);
        if (s?.recipient_person_id) add('person', s.recipient_person_id, 'recipient', 'serve_queue');
        if (s?.property_id) add('property', s.property_id, 'location', 'serve_queue');
        if (s?.call_id) add('call', s.call_id, 'serve_from_call', 'serve_queue');
        break;
      }

      case 'intel_report': {
        // Only a disseminated product exposes its links (parity with loadNode's
        // status gate) — a draft report's edges must not surface in the graph.
        const dissem = await queryFirst<any>(db,
          "SELECT 1 AS ok FROM intel_reports WHERE id = ? AND status = 'disseminated'", id);
        if (dissem) {
          for (const r of await query<any>(db,
            `SELECT entity_type, entity_id, role FROM intel_report_links WHERE report_id = ? LIMIT 200`, id))
            add(r.entity_type, r.entity_id, r.role || 'mentioned', 'intel_report_links');
        }
        break;
      }

      case 'forensic_case': {
        for (const r of await query<any>(db, 'SELECT id FROM forensic_exhibits WHERE forensic_case_id = ?', id))
          add('forensic_exhibit', r.id, 'exhibit_of', 'forensic_exhibits');
        break;
      }
    }
  } catch (err) {
    log.warn('Connections junction query error (${type}#${id})', { error: err instanceof Error ? err.message : String(err) });
  }

  // 3. Disseminated intel products that name this entity (any node type).
  try {
    for (const r of await query<any>(db,
      `SELECT l.report_id, l.role FROM intel_report_links l
       JOIN intel_reports rp ON rp.id = l.report_id
       WHERE l.entity_type = ? AND l.entity_id = ? AND rp.status = 'disseminated'
       LIMIT 200`, type, id))
      add('intel_report', r.report_id, r.role || 'intel_subject', 'intel_report_links');
  } catch (err) { log.warn('Connections intel link edges error', { error: err instanceof Error ? err.message : String(err) }); }

  return results;
}

// ── BFS Graph Builder ────────────────────────────────────────
// MAX_NODES doubles as a subrequest safety bound: a dense person node
// fans out ~12 D1 queries in findConnections, so the cap keeps a worst
// -case graph well under the Workers per-request subrequest ceiling.

const MAX_NODES = 120;

async function buildGraph(
  db: D1Database,
  seedType: string,
  seedId: number,
  maxDepth = 2,
  dateFrom?: string,
  dateTo?: string,
): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
  const nodeMap = new Map<string, GNode>();
  const edgeSet = new Set<string>();
  const edges: GEdge[] = [];
  const queue: Array<{ type: string; id: number; depth: number }> = [];
  const loadCache = new Map<string, { label: string; metadata: Record<string, any> }>();

  const nodeKey = (type: string, id: number) => `${type}-${id}`;

  async function cachedLoad(type: string, id: number) {
    const k = nodeKey(type, id);
    const hit = loadCache.get(k);
    if (hit) return hit;
    const fresh = await loadNode(db, type, id);
    loadCache.set(k, fresh);
    return fresh;
  }

  async function addNode(type: string, id: number, depth: number): Promise<boolean> {
    if (nodeMap.size >= MAX_NODES) return false;
    const key = nodeKey(type, id);
    if (nodeMap.has(key)) return false;
    const { label, metadata } = await cachedLoad(type, id);
    nodeMap.set(key, { id: key, type, entityId: id, label, metadata, depth });
    return true;
  }

  function addEdge(srcType: string, srcId: number, tgtType: string, tgtId: number, relationship: string, sourceTable: string) {
    const src = nodeKey(srcType, srcId);
    const tgt = nodeKey(tgtType, tgtId);
    const edgeKey = [src, tgt].sort().join('|') + '|' + relationship;
    if (edgeSet.has(edgeKey)) return;
    edgeSet.add(edgeKey);
    edges.push({ source: src, target: tgt, relationship, sourceTable });
  }

  await addNode(seedType, seedId, 0);
  queue.push({ type: seedType, id: seedId, depth: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    if (nodeMap.size >= MAX_NODES) break;

    const nextDepth = current.depth + 1;
    const conns = await findConnections(db, current.type, current.id);
    for (const conn of conns) {
      if (nodeMap.size >= MAX_NODES) break;
      const isNew = await addNode(conn.type, conn.id, nextDepth);
      addEdge(current.type, current.id, conn.type, conn.id, conn.relationship, conn.sourceTable);
      if (isNew && nextDepth < maxDepth) {
        queue.push({ type: conn.type, id: conn.id, depth: nextDepth });
      }
    }
  }

  let nodes = Array.from(nodeMap.values());
  if (dateFrom || dateTo) {
    nodes = await filterNodesByDateRange(db, nodes, dateFrom, dateTo);
    const keptKeys = new Set(nodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => keptKeys.has(e.source) && keptKeys.has(e.target));
    return { nodes, edges: filteredEdges };
  }
  return { nodes, edges };
}

// Batches by type (one query per type present in the node set, using an
// IN(...) clause) rather than one query per node — avoids the N+1 pattern
// a prior code review flagged in similar per-row hash-lookup code.
// Nodes whose type has no DATE_FIELD entry (person/vehicle/property/...)
// always pass through unfiltered.
async function filterNodesByDateRange(
  db: D1Database, nodes: GNode[], dateFrom?: string, dateTo?: string,
): Promise<GNode[]> {
  const byType = new Map<string, number[]>();
  for (const n of nodes) {
    if (!DATE_FIELD[n.type]) continue;
    // alpr_sighting nodes with a negative entityId are vehicle_sightings
    // rows (negated to avoid colliding with alpr_captures' own id space —
    // see loadNode's case 'alpr_sighting'). Route them to their own pass
    // below instead of batching them against alpr_captures.
    if (n.type === 'alpr_sighting' && n.entityId < 0) continue;
    byType.set(n.type, [...(byType.get(n.type) || []), n.entityId]);
  }
  const inRange = new Set<string>();
  for (const [type, ids] of byType) {
    const table = TIMELINE_TABLE[type];
    const col = DATE_FIELD[type];
    if (!table) continue;
    try {
      // ids can reach MAX_NODES (120) — chunk to stay under D1's 100-param cap.
      // leadingBindings (date bounds) are bound before the IN-list chunk so the
      // SQL must list those conditions first.
      const leading: unknown[] = [];
      const dateConditions: string[] = [];
      if (dateFrom) { dateConditions.push(`${col} >= ?`); leading.push(dateFrom); }
      if (dateTo) { dateConditions.push(`${col} <= ?`); leading.push(dateTo); }
      const prefix = dateConditions.length ? dateConditions.join(' AND ') + ' AND ' : '';
      const rows = await queryInChunks<{ id: number }>(
        db,
        ids,
        (ph) => `SELECT id FROM ${table} WHERE ${prefix}id IN (${ph})`,
        leading,
      );
      for (const r of rows) inRange.add(`${type}-${r.id}`);
    } catch (err) {
      log.warn('Connections date-filter ${type} error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Separate pass for vehicle_sightings-sourced alpr_sighting nodes
  // (negative entityId). Query vehicle_sightings directly using the real
  // (un-negated) id, but record the inRange key using the SAME nodeKey
  // format (`${type}-${id}`) the graph builder used, i.e. with the
  // negative id — GNode.id is literally `alpr_sighting--${realId}`.
  const vsIds = nodes.filter((n) => n.type === 'alpr_sighting' && n.entityId < 0).map((n) => -n.entityId);
  if (vsIds.length) {
    try {
      const vsLeading: unknown[] = [];
      const vsDateConds: string[] = [];
      if (dateFrom) { vsDateConds.push(`created_at >= ?`); vsLeading.push(dateFrom); }
      if (dateTo) { vsDateConds.push(`created_at <= ?`); vsLeading.push(dateTo); }
      const vsPrefix = vsDateConds.length ? vsDateConds.join(' AND ') + ' AND ' : '';
      const rows = await queryInChunks<{ id: number }>(
        db,
        vsIds,
        (ph) => `SELECT id FROM vehicle_sightings WHERE ${vsPrefix}id IN (${ph})`,
        vsLeading,
      );
      for (const r of rows) inRange.add(`alpr_sighting-${-r.id}`);
    } catch (err) {
      log.warn('Connections date-filter alpr_sighting(vehicle_sightings) error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return nodes.filter((n) => !DATE_FIELD[n.type] || inRange.has(n.id));
}

// ── Shortest-path BFS ────────────────────────────────────────

const PATH_MAX_DEPTH = 6;

async function findShortestPath(
  db: D1Database,
  fromType: string,
  fromId: number,
  toType: string,
  toId: number,
): Promise<{ path: GNode[]; edges: GEdge[] } | null> {
  const fromKey = `${fromType}-${fromId}`;
  const toKey = `${toType}-${toId}`;

  if (fromKey === toKey) {
    const { label, metadata } = await loadNode(db, fromType, fromId);
    return { path: [{ id: fromKey, type: fromType, entityId: fromId, label, metadata, depth: 0 }], edges: [] };
  }

  type Entry = { key: string; type: string; id: number; parent: string | null; rel: string; srcTable: string; depth: number };
  const visited = new Map<string, Entry>();
  visited.set(fromKey, { key: fromKey, type: fromType, id: fromId, parent: null, rel: '', srcTable: '', depth: 0 });
  const queue: Entry[] = [visited.get(fromKey)!];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= PATH_MAX_DEPTH) continue;

    const conns = await findConnections(db, current.type, current.id);
    for (const conn of conns) {
      const ckey = `${conn.type}-${conn.id}`;
      if (visited.has(ckey)) continue;
      const entry: Entry = {
        key: ckey, type: conn.type, id: conn.id,
        parent: current.key, rel: conn.relationship, srcTable: conn.sourceTable,
        depth: current.depth + 1,
      };
      visited.set(ckey, entry);

      if (ckey === toKey) {
        const chain: Entry[] = [];
        let cur: Entry | undefined = entry;
        while (cur) {
          chain.unshift(cur);
          cur = cur.parent ? visited.get(cur.parent) : undefined;
        }
        const path: GNode[] = [];
        for (const e of chain) {
          const { label, metadata } = await loadNode(db, e.type, e.id);
          path.push({ id: e.key, type: e.type, entityId: e.id, label, metadata, depth: e.depth });
        }
        const pedges: GEdge[] = chain.slice(1).map((e) => ({
          source: e.parent!, target: e.key, relationship: e.rel, sourceTable: e.srcTable,
        }));
        return { path, edges: pedges };
      }

      queue.push(entry);
    }
  }

  return null;
}

// ── Routes ───────────────────────────────────────────────────

const operational = requireRole(...OPERATIONAL_ROLES);

// ═══════════════════════════════════════════════════════════════
// MAP OVERLAY — read-only detail views, NOT graph nodes (see design
// spec non-goals: GPS breadcrumbs are too high-volume to graph 1:1).
// Registered before /graph, /path, /search, /timeline, /investigations
// (none of which match a 3-segment /:type/:id/<suffix> path), so there
// is no shadowing risk in either direction.
// ═══════════════════════════════════════════════════════════════

// GET /:type/:id/gps-track?date_from=&date_to= — for a person node,
// resolves their assigned units (units.officer_id) and returns
// gps_breadcrumbs for those units. For a call node, returns breadcrumbs
// where current_call_id matches. Any other type returns an empty array
// rather than an error, keeping the map panel silent for node types
// with no GPS relevance.
connections.get('/:type/:id/gps-track', operational, async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.param('type');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type === 'person') {
      conditions.push('officer_id = ?');
      params.push(id);
    } else if (type === 'call') {
      conditions.push('current_call_id = ?');
      params.push(id);
    } else {
      return c.json({ data: [] });
    }
    if (dateFrom) { conditions.push('recorded_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('recorded_at <= ?'); params.push(dateTo); }

    const rows = await query<{ latitude: number; longitude: number; recorded_at: string }>(
      db,
      `SELECT latitude, longitude, recorded_at FROM gps_breadcrumbs WHERE ${conditions.join(' AND ')} ORDER BY recorded_at ASC LIMIT 2000`,
      ...params,
    );
    return c.json({ data: rows.map((r) => ({ lat: r.latitude, lng: r.longitude, recorded_at: r.recorded_at })) });
  } catch (err) {
    log.warn('Connections gps-track error', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ data: [] });
  }
});

// GET /:type/:id/geo-points?date_from=&date_to= — for vehicle/call/
// incident nodes, returns ALPR capture lat/lng as pins (source: 'alpr').
connections.get('/:type/:id/geo-points', operational, async (c) => {
  try {
    const db = getDb(c.env);
    const type = c.req.param('type');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid ID', code: 'INVALID_ID' }, 400);
    const dateFrom = c.req.query('date_from');
    const dateTo = c.req.query('date_to');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (type === 'vehicle') {
      // Boundary-anchored match against the JSON.stringify'd array in
      // vehicle_record_ids (same pattern already used for alpr_captures
      // in findConnections' vehicle branch — an unanchored LIKE would
      // also match "[15]"/"[21]" for id=1).
      conditions.push(`(
        vehicle_record_ids = '[' || ? || ']'
        OR vehicle_record_ids LIKE '[' || ? || ',%'
        OR vehicle_record_ids LIKE '%,' || ? || ']'
        OR vehicle_record_ids LIKE '%,' || ? || ',%'
      )`);
      params.push(String(id), String(id), String(id), String(id));
    } else if (type === 'call') {
      conditions.push('call_id = ?');
      params.push(id);
    } else if (type === 'incident') {
      conditions.push('incident_id = ?');
      params.push(id);
    } else {
      return c.json({ data: [] });
    }
    if (dateFrom) { conditions.push('created_at >= ?'); params.push(dateFrom); }
    if (dateTo) { conditions.push('created_at <= ?'); params.push(dateTo); }

    const rows = await query<{ lat: number; lng: number; created_at: string; plate: string }>(
      db,
      `SELECT lat, lng, created_at, plate FROM alpr_captures WHERE ${conditions.join(' AND ')} AND lat IS NOT NULL ORDER BY created_at DESC LIMIT 500`,
      ...params,
    );
    return c.json({ data: rows.map((r) => ({ lat: r.lat, lng: r.lng, source: 'alpr', label: r.plate, recorded_at: r.created_at })) });
  } catch (err) {
    log.warn('Connections geo-points error', { error: err instanceof Error ? err.message : String(err) });
    return c.json({ data: [] });
  }
});

// GET /graph?type=person&id=123&depth=2
connections.get('/graph', operational, async (c) => {
  const type = c.req.query('type');
  const id = c.req.query('id');
  const depth = c.req.query('depth');

  if (!type || !id) {
    return c.json({ error: 'type and id query parameters are required', code: 'TYPE_AND_ID_QUERY' }, 400);
  }
  if (!VALID_TYPES.includes(type)) {
    return c.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, 400);
  }
  if (!Number.isFinite(Number(id)) || Number(id) < 1) {
    return c.json({ error: 'id must be a positive integer', code: 'ID_MUST_BE_A' }, 400);
  }

  const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);
  const dateFrom = c.req.query('date_from') || undefined;
  const dateTo = c.req.query('date_to') || undefined;
  const graph = await buildGraph(getDb(c.env), type, Number(id), maxDepth, dateFrom, dateTo);
  await audit(c, 'SEARCH', 'record_link', Number(id), `Connection graph: ${type} #${id} (depth ${maxDepth}, ${graph.nodes.length} nodes)`);
  return c.json(graph);
});

// GET /path?fromType=X&fromId=Y&toType=A&toId=B
connections.get('/path', operational, async (c) => {
  const fromType = c.req.query('fromType');
  const fromId = c.req.query('fromId');
  const toType = c.req.query('toType');
  const toId = c.req.query('toId');

  if (!fromType || !fromId || !toType || !toId) {
    return c.json({ error: 'fromType, fromId, toType, and toId are all required', code: 'PATH_PARAMS_REQUIRED' }, 400);
  }
  if (!VALID_TYPES.includes(fromType)) return c.json({ error: `Invalid fromType. Must be one of: ${VALID_TYPES.join(', ')}` }, 400);
  if (!VALID_TYPES.includes(toType)) return c.json({ error: `Invalid toType. Must be one of: ${VALID_TYPES.join(', ')}` }, 400);
  // alpr_sighting ids may be negative — vehicle_sightings rows are encoded
  // as -id to avoid colliding with alpr_captures' own id space (see
  // loadNode's case 'alpr_sighting'). So only reject 0/NaN, not negatives.
  if (!Number.isInteger(Number(fromId)) || Number(fromId) === 0 || !Number.isInteger(Number(toId)) || Number(toId) === 0) {
    return c.json({ error: 'fromId and toId must be nonzero integers' }, 400);
  }

  const result = await findShortestPath(getDb(c.env), fromType, Number(fromId), toType, Number(toId));
  if (!result) {
    return c.json({ error: `No path found within ${PATH_MAX_DEPTH} hops`, code: 'NO_PATH' }, 404);
  }
  await audit(c, 'SEARCH', 'record_link', Number(fromId), `Path search: ${fromType} #${fromId} → ${toType} #${toId} (${result.edges.length} hops)`);
  return c.json(result);
});

// GET /search?q=term — cross-entity search
connections.get('/search', operational, async (c) => {
  const q = c.req.query('q');
  if (!q || q.trim().length < 2) return c.json([]);

  const db = getDb(c.env);
  // D1 LIKE cap: pattern >50 chars fails. escapeLike LENGTHENS the string, so
  // cappedLikePattern truncates the ESCAPED term to keep '%'+escaped+'%' <=50.
  const raw = q.trim().slice(0, 40);
  const term = cappedLikePattern(raw);
  const incidentTypeMatch = codedLike('incident_type', raw);
  const results: Array<{ id: number; type: string; label: string }> = [];

  try {
    for (const p of await query<any>(db, `SELECT id, first_name, last_name FROM persons WHERE first_name LIKE ? ESCAPE '\' OR last_name LIKE ? ESCAPE '\' OR (first_name || ' ' || last_name) LIKE ? ESCAPE '\' LIMIT 8`, term, term, term))
      results.push({ id: p.id, type: 'person', label: `${p.first_name} ${p.last_name}` });
  } catch (err) { log.warn('Connections persons search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const v of await query<any>(db, `SELECT id, make, model, plate_number, color FROM vehicles_records WHERE make LIKE ? ESCAPE '\' OR model LIKE ? ESCAPE '\' OR plate_number LIKE ? ESCAPE '\' OR vin LIKE ? ESCAPE '\' LIMIT 8`, term, term, term, term))
      results.push({ id: v.id, type: 'vehicle', label: `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.replace(/\s+/g, ' ').trim() });
  } catch (err) { log.warn('Connections vehicles search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const p of await query<any>(db, `SELECT id, name FROM properties WHERE name LIKE ? ESCAPE '\' OR address LIKE ? ESCAPE '\' LIMIT 8`, term, term))
      results.push({ id: p.id, type: 'property', label: p.name });
  } catch (err) { log.warn('Connections properties search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const b of await query<any>(db, `SELECT id, name, dba_name, address FROM businesses WHERE name LIKE ? ESCAPE '\' OR dba_name LIKE ? ESCAPE '\' OR address LIKE ? ESCAPE '\' OR owner_name LIKE ? ESCAPE '\' LIMIT 8`, term, term, term, term))
      results.push({ id: b.id, type: 'business', label: b.dba_name ? `${b.name} (${b.dba_name})` : (b.name || b.address || `Business #${b.id}`) });
  } catch (err) { log.warn('Connections businesses search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const r of await query<any>(db, `SELECT id, case_number, title FROM cases WHERE case_number LIKE ? ESCAPE '\' OR title LIKE ? ESCAPE '\' LIMIT 8`, term, term))
      results.push({ id: r.id, type: 'case', label: `${r.case_number} - ${r.title}` });
  } catch (err) { log.warn('Connections cases search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const i of await query<any>(db, `SELECT id, incident_number, incident_type FROM incidents WHERE incident_number LIKE ? ESCAPE '\' OR ${incidentTypeMatch.sql} OR location_address LIKE ? ESCAPE '\' LIMIT 8`, term, ...incidentTypeMatch.binds, term))
      results.push({ id: i.id, type: 'incident', label: `${i.incident_number || ''} ${i.incident_type}`.trim() });
  } catch (err) { log.warn('Connections incidents search error', { error: err instanceof Error ? err.message : String(err) }); }

  // Calls for service — searchable so an analyst can seed a graph on a CFS.
  try {
    for (const cf of await query<any>(db, `SELECT id, call_number, incident_type, status FROM calls_for_service WHERE call_number LIKE ? ESCAPE '\' OR ${incidentTypeMatch.sql} OR location_address LIKE ? ESCAPE '\' LIMIT 8`, term, ...incidentTypeMatch.binds, term))
      results.push({ id: cf.id, type: 'call', label: `${cf.call_number || `CFS-${cf.id}`} ${cf.incident_type || ''} (${(cf.status || '?').toUpperCase()})`.replace(/\s+/g, ' ').trim() });
  } catch (err) { log.warn('Connections calls search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const w of await query<any>(db, `SELECT id, warrant_number, status FROM warrants WHERE warrant_number LIKE ? ESCAPE '\' OR subject_name LIKE ? ESCAPE '\' LIMIT 8`, term, term))
      results.push({ id: w.id, type: 'warrant', label: `${w.warrant_number || `W-${w.id}`} (${w.status || '?'})` });
  } catch (err) { log.warn('Connections warrants search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const e of await query<any>(db, `SELECT id, evidence_number, description FROM evidence WHERE evidence_number LIKE ? ESCAPE '\' OR description LIKE ? ESCAPE '\' LIMIT 8`, term, term))
      results.push({ id: e.id, type: 'evidence', label: `${e.evidence_number || ''} ${e.description || ''}`.trim() });
  } catch (err) { log.warn('Connections evidence search error', { error: err instanceof Error ? err.message : String(err) }); }

  try {
    for (const r of await query<any>(db,
      `SELECT id, report_number, title FROM intel_reports
       WHERE status = 'disseminated' AND (report_number LIKE ? ESCAPE '\' OR title LIKE ? ESCAPE '\') LIMIT 8`, term, term))
      results.push({ id: r.id, type: 'intel_report', label: `${r.report_number || `INT-${r.id}`} — ${r.title || ''}`.trim() });
  } catch (err) { log.warn('Connections intel search error', { error: err instanceof Error ? err.message : String(err) }); }

  return c.json(results);
});

// GET /timeline?nodes=person:1,incident:5,intel_report:3 — merged chronology of a node set
const TIMELINE_QUERY: Record<string, string> = {
  incident: 'id, incident_number, incident_type, occurred_date, created_at, location_address, status',
  call: 'id, call_number, incident_type, created_at, location_address, status',
  citation: 'id, citation_number, violation_description, violation_date, status',
  warrant: 'id, warrant_number, charge_description, issued_date, status',
  arrest: 'id, full_name, charges, booking_date, status',
  field_interview: 'id, fi_number, contact_reason, created_at, status',
  trespass_order: 'id, order_number, location, effective_date, status',
  case: 'id, case_number, title, case_type, created_at, status',
  evidence: 'id, evidence_number, description, created_at, status',
  intel_report: 'id, report_number, title, disseminated_at, source_reliability, info_credibility, threat_level',
};
const TIMELINE_TABLE: Record<string, string> = {
  incident: 'incidents', call: 'calls_for_service', citation: 'citations', warrant: 'warrants',
  arrest: 'arrest_records', field_interview: 'field_interviews', trespass_order: 'trespass_orders',
  case: 'cases', evidence: 'evidence', intel_report: 'intel_reports', alpr_sighting: 'alpr_captures',
};

// Canonical "when did this happen" column per node type, for date-range
// filtering. Deliberately a SUBSET of VALID_TYPES — person/vehicle/
// property/business/etc. have no single occurrence date, so they're
// never filtered by range (an investigator shouldn't lose a person from
// the graph just because they're time-filtering incidents).
const DATE_FIELD: Record<string, string> = {
  incident: 'occurred_date', call: 'created_at', citation: 'violation_date',
  warrant: 'issued_date', arrest: 'booking_date', field_interview: 'created_at',
  trespass_order: 'effective_date', case: 'created_at', evidence: 'created_at',
  intel_report: 'disseminated_at', alpr_sighting: 'created_at',
};

connections.get('/timeline', operational, async (c) => {
  const refs = parseNodeRefs(c.req.query('nodes') || '');
  const byType = new Map<string, number[]>();
  for (const r of refs) {
    if (!TIMELINE_QUERY[r.type]) continue; // skip undated types (person/vehicle/property/...)
    byType.set(r.type, [...(byType.get(r.type) || []), r.id]);
  }
  const db = getDb(c.env);
  const sources: any[][] = [];
  for (const [type, ids] of byType) {
    try {
      // Chunk to avoid D1's 100-bound-parameter cap — ?nodes= is unbounded.
      const extra = type === 'intel_report' ? "AND status = 'disseminated'" : '';
      const rows = await queryInChunks<any>(
        db,
        ids,
        (ph) => `SELECT ${TIMELINE_QUERY[type]} FROM ${TIMELINE_TABLE[type]} WHERE id IN (${ph}) ${extra}`,
      );
      sources.push(rows.map((row) => buildTimelineEvent(type, row)).filter(Boolean));
    } catch (err) { log.warn('Connections timeline ${type} error', { error: err instanceof Error ? err.message : String(err) }); }
  }
  return c.json(mergeTimeline(sources as any));
});

// ─── INVESTIGATIONS CRUD ────────────────────────────────────
// Saved Connections workspaces: user-owned graph + pinned layout +
// annotations. Private by default; read-shared via shared_user_ids.

function canReadInvestigation(inv: any, userId: number): boolean {
  if (inv.user_id === userId) return true;
  try {
    const shared = JSON.parse(inv.shared_user_ids || '[]');
    return Array.isArray(shared) && shared.includes(userId);
  } catch { return false; }
}

// POST /investigations
connections.post('/investigations', operational, async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

  const body = await c.req.json().catch(() => ({}));
  const { name, description, seed_nodes, pinned_layout, annotations, shared_user_ids } = body || {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return c.json({ error: 'name is required', code: 'NAME_REQUIRED' }, 400);
  }

  const db = getDb(c.env);
  const info = await execute(
    db,
    `INSERT INTO connection_investigations (user_id, name, description, seed_nodes, pinned_layout, annotations, shared_user_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId,
    name.trim(),
    description || null,
    JSON.stringify(seed_nodes || []),
    pinned_layout ? JSON.stringify(pinned_layout) : null,
    annotations ? JSON.stringify(annotations) : null,
    JSON.stringify(shared_user_ids || []),
  );
  const newId = Number(info.meta.last_row_id);
  const created = await queryFirst<any>(db, 'SELECT * FROM connection_investigations WHERE id = ?', newId);
  await audit(c, 'CREATE', 'connection_investigation', newId, `Investigation: ${name.trim()}`);
  return c.json(created, 201);
});

// GET /investigations — mine + shared-with-me
connections.get('/investigations', operational, async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

  // shared_user_ids is a JSON array like '[1,2,3]'. Normalize to
  // ',1,2,3,' and match ',<userId>,' so `1` doesn't match inside `12`.
  const sharedPattern = `%,${userId},%`;
  const visible = await query<any>(
    getDb(c.env),
    `SELECT * FROM connection_investigations
     WHERE user_id = ?
        OR ',' || REPLACE(REPLACE(shared_user_ids, '[', ''), ']', '') || ',' LIKE ?
     ORDER BY updated_at DESC
     LIMIT 500`,
    userId, sharedPattern,
  );
  return c.json(visible);
});

// GET /investigations/:id
connections.get('/investigations/:id', operational, async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthenticated' }, 401);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

  const row = await queryFirst<any>(getDb(c.env), 'SELECT * FROM connection_investigations WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
  if (!canReadInvestigation(row, userId)) return c.json({ error: 'Forbidden', code: 'INV_FORBIDDEN' }, 403);
  return c.json(row);
});

// PUT /investigations/:id — owner only
connections.put('/investigations/:id', operational, async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthenticated' }, 401);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

  const db = getDb(c.env);
  const row = await queryFirst<any>(db, 'SELECT * FROM connection_investigations WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Only owner can update', code: 'INV_NOT_OWNER' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const { name, description, seed_nodes, pinned_layout, annotations, shared_user_ids } = body || {};

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(String(name).trim()); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (seed_nodes !== undefined) { updates.push('seed_nodes = ?'); params.push(JSON.stringify(seed_nodes)); }
  if (pinned_layout !== undefined) { updates.push('pinned_layout = ?'); params.push(pinned_layout ? JSON.stringify(pinned_layout) : null); }
  if (annotations !== undefined) { updates.push('annotations = ?'); params.push(annotations ? JSON.stringify(annotations) : null); }
  if (shared_user_ids !== undefined) { updates.push('shared_user_ids = ?'); params.push(JSON.stringify(shared_user_ids)); }
  updates.push("updated_at = datetime('now')");

  if (updates.length === 1) return c.json(row); // nothing to update besides timestamp

  params.push(id);
  await execute(db, `UPDATE connection_investigations SET ${updates.join(', ')} WHERE id = ?`, ...params);
  const updated = await queryFirst<any>(db, 'SELECT * FROM connection_investigations WHERE id = ?', id);
  await audit(c, 'UPDATE', 'connection_investigation', id, 'Investigation updated');
  return c.json(updated);
});

// DELETE /investigations/:id — owner only
connections.delete('/investigations/:id', operational, async (c) => {
  const userId = c.get('userId') as number | undefined;
  if (!userId) return c.json({ error: 'Unauthenticated' }, 401);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

  const db = getDb(c.env);
  const row = await queryFirst<any>(db, 'SELECT user_id FROM connection_investigations WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Only owner can delete', code: 'INV_NOT_OWNER' }, 403);

  await execute(db, 'DELETE FROM connection_investigations WHERE id = ?', id);
  await audit(c, 'DELETE', 'connection_investigation', id, 'Investigation deleted');
  return c.json({ success: true });
});

export default connections;
