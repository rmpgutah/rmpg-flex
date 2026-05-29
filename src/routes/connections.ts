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
import { getDb, query, queryFirst, execute } from '../utils/db';
import { requireRole } from '../middleware/auth';

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
  'person', 'vehicle', 'property', 'evidence', 'case', 'incident',
  'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order',
  'serve_job', 'call', 'report',
];

// ── Helpers ──────────────────────────────────────────────────

// Escape LIKE wildcards so a search for "50%" doesn't match everything.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Best-effort audit row. MUST NOT throw — a failed audit write can never
// be allowed to fail the user's request.
async function audit(
  c: Context,
  action: string,
  entityType: string,
  entityId: number | string,
  details: string,
): Promise<void> {
  try {
    await execute(
      getDb(c.env),
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      (c.get('userId') as number | undefined) ?? null,
      action,
      entityType,
      String(entityId),
      details,
      c.req.header('CF-Connecting-IP') ?? null,
    );
  } catch (err: any) {
    console.error('[Connections] audit write failed:', err?.message);
  }
}

// ── Node loading (label + metadata in one query) ─────────────
// Returns the full metadata row AND a human-readable label derived from
// it — one SELECT per node instead of two.

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
        const w = await queryFirst<any>(db, 'SELECT warrant_number, status, type, offense_level, subject_person_id, person_id, charge_description FROM warrants WHERE id = ?', id);
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
      default:
        return { label: `${type} #${id}`, metadata: {} };
    }
  } catch (err: any) {
    console.error(`[Connections] loadNode ${type}#${id} error:`, err?.message);
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
  } catch (err: any) {
    console.error('[Connections] record_links query error:', err?.message);
  }

  // 2. Type-specific junction / FK traversal
  try {
    switch (type) {
      case 'person': {
        for (const r of await query<any>(db, 'SELECT incident_id, role FROM incident_persons WHERE person_id = ?', id))
          add('incident', r.incident_id, r.role || 'involved', 'incident_persons');
        // person → call (direct CFS involvement)
        for (const r of await query<any>(db, 'SELECT call_id, role FROM call_persons WHERE person_id = ?', id))
          if (r.call_id) add('call', r.call_id, r.role || 'subject', 'call_persons');
        for (const r of await query<any>(db, 'SELECT id FROM vehicles_records WHERE owner_person_id = ?', id))
          add('vehicle', r.id, 'owner', 'vehicles_records');
        for (const r of await query<any>(db, 'SELECT case_id FROM case_person_links WHERE person_id = ?', id))
          add('case', r.case_id, 'linked', 'case_person_links');
        for (const r of await query<any>(db, 'SELECT cp.relationship, p.id AS property_id FROM client_persons cp JOIN properties p ON p.client_id = cp.client_id WHERE cp.person_id = ? LIMIT 1000', id))
          add('property', r.property_id, r.relationship || 'client', 'client_persons');
        for (const r of await query<any>(db, 'SELECT id, status FROM warrants WHERE subject_person_id = ? OR person_id = ?', id, id))
          add('warrant', r.id, `warrant_${(r.status || '').toLowerCase()}`, 'warrants');
        for (const r of await query<any>(db, 'SELECT id, status FROM citations WHERE person_id = ?', id))
          add('citation', r.id, `citation_${(r.status || '').toLowerCase()}`, 'citations');
        for (const r of await query<any>(db, "SELECT arrest_record_id FROM arrest_cross_links WHERE linked_type = 'person' AND linked_id = ?", id))
          add('arrest', r.arrest_record_id, 'arrested', 'arrest_cross_links');
        for (const r of await query<any>(db, 'SELECT id FROM field_interviews WHERE person_id = ?', id))
          add('field_interview', r.id, 'fi_contact', 'field_interviews');
        for (const r of await query<any>(db, 'SELECT id FROM trespass_orders WHERE person_id = ?', id))
          add('trespass_order', r.id, 'trespassed_from', 'trespass_orders');
        for (const r of await query<any>(db, 'SELECT id FROM serve_queue WHERE recipient_person_id = ?', id))
          add('serve_job', r.id, 'serve_recipient', 'serve_queue');
        break;
      }

      case 'vehicle': {
        for (const r of await query<any>(db, 'SELECT incident_id, role FROM incident_vehicles WHERE vehicle_id = ?', id))
          add('incident', r.incident_id, r.role || 'involved', 'incident_vehicles');
        for (const r of await query<any>(db, 'SELECT call_id, role FROM call_vehicles WHERE vehicle_id = ?', id))
          if (r.call_id) add('call', r.call_id, r.role || 'involved', 'call_vehicles');
        const v = await queryFirst<any>(db, 'SELECT owner_person_id FROM vehicles_records WHERE id = ?', id);
        if (v?.owner_person_id) add('person', v.owner_person_id, 'owner', 'vehicles_records');
        for (const r of await query<any>(db, 'SELECT id, status FROM citations WHERE vehicle_id = ?', id))
          add('citation', r.id, `citation_${(r.status || '').toLowerCase()}`, 'citations');
        for (const r of await query<any>(db, 'SELECT id FROM field_interviews WHERE vehicle_id = ?', id))
          add('field_interview', r.id, 'fi_vehicle', 'field_interviews');
        break;
      }

      case 'incident': {
        for (const r of await query<any>(db, 'SELECT person_id, role FROM incident_persons WHERE incident_id = ?', id))
          add('person', r.person_id, r.role || 'involved', 'incident_persons');
        for (const r of await query<any>(db, 'SELECT vehicle_id, role FROM incident_vehicles WHERE incident_id = ?', id))
          add('vehicle', r.vehicle_id, r.role || 'involved', 'incident_vehicles');
        for (const r of await query<any>(db, 'SELECT id FROM evidence WHERE incident_id = ?', id))
          add('evidence', r.id, 'collected_from', 'evidence');
        const inc = await queryFirst<any>(db, 'SELECT property_id, call_id FROM incidents WHERE id = ?', id);
        if (inc?.property_id) add('property', inc.property_id, 'location', 'incidents');
        if (inc?.call_id) add('call', inc.call_id, 'originating_call', 'incidents');
        for (const r of await query<any>(db, 'SELECT case_id FROM case_incident_links WHERE incident_id = ?', id))
          add('case', r.case_id, 'linked', 'case_incident_links');
        for (const r of await query<any>(db, 'SELECT id, report_type FROM supplemental_reports WHERE incident_id = ?', id))
          add('report', r.id, r.report_type || 'supplemental', 'supplemental_reports');
        for (const r of await query<any>(db, 'SELECT id, status FROM citations WHERE incident_id = ?', id))
          add('citation', r.id, `citation_${(r.status || '').toLowerCase()}`, 'citations');
        break;
      }

      case 'call': {
        for (const r of await query<any>(db, 'SELECT person_id, role FROM call_persons WHERE call_id = ?', id))
          add('person', r.person_id, r.role || 'subject', 'call_persons');
        for (const r of await query<any>(db, 'SELECT vehicle_id, role FROM call_vehicles WHERE call_id = ?', id))
          add('vehicle', r.vehicle_id, r.role || 'involved', 'call_vehicles');
        for (const r of await query<any>(db, 'SELECT id FROM incidents WHERE call_id = ?', id))
          add('incident', r.id, 'incident_from_call', 'incidents');
        const cf = await queryFirst<any>(db, 'SELECT property_id, case_id FROM calls_for_service WHERE id = ?', id);
        if (cf?.property_id) add('property', cf.property_id, 'location', 'calls_for_service');
        if (cf?.case_id) add('case', cf.case_id, 'linked', 'calls_for_service');
        for (const r of await query<any>(db, 'SELECT id FROM citations WHERE call_id = ?', id))
          add('citation', r.id, 'cited_on_call', 'citations');
        for (const r of await query<any>(db, 'SELECT id FROM field_interviews WHERE associated_call_id = ?', id))
          add('field_interview', r.id, 'fi_on_call', 'field_interviews');
        for (const r of await query<any>(db, 'SELECT id FROM trespass_orders WHERE originating_call_id = ?', id))
          add('trespass_order', r.id, 'order_from_call', 'trespass_orders');
        for (const r of await query<any>(db, 'SELECT id FROM serve_queue WHERE call_id = ?', id))
          add('serve_job', r.id, 'serve_from_call', 'serve_queue');
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

      case 'evidence': {
        const ev = await queryFirst<any>(db, 'SELECT incident_id FROM evidence WHERE id = ?', id);
        if (ev?.incident_id) add('incident', ev.incident_id, 'collected_from', 'evidence');
        for (const r of await query<any>(db, 'SELECT case_id FROM case_evidence_links WHERE evidence_id = ?', id))
          add('case', r.case_id, 'linked', 'case_evidence_links');
        break;
      }

      case 'warrant': {
        const w = await queryFirst<any>(db, 'SELECT subject_person_id, person_id FROM warrants WHERE id = ?', id);
        const pid = w?.subject_person_id ?? w?.person_id;
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
    }
  } catch (err: any) {
    console.error(`[Connections] junction query error (${type}#${id}):`, err?.message);
  }

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

  return { nodes: Array.from(nodeMap.values()), edges };
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
  if (isNaN(Number(id)) || Number(id) < 1) {
    return c.json({ error: 'id must be a positive integer', code: 'ID_MUST_BE_A' }, 400);
  }

  const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);
  const graph = await buildGraph(getDb(c.env), type, Number(id), maxDepth);
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
  if (isNaN(Number(fromId)) || Number(fromId) < 1 || isNaN(Number(toId)) || Number(toId) < 1) {
    return c.json({ error: 'fromId and toId must be positive integers' }, 400);
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
  const term = `%${escapeLike(q.trim())}%`;
  const results: Array<{ id: number; type: string; label: string }> = [];

  try {
    for (const p of await query<any>(db, `SELECT id, first_name, last_name FROM persons WHERE first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR (first_name || ' ' || last_name) LIKE ? ESCAPE '\\' LIMIT 8`, term, term, term))
      results.push({ id: p.id, type: 'person', label: `${p.first_name} ${p.last_name}` });
  } catch (err: any) { console.error('[Connections] persons search error:', err?.message); }

  try {
    for (const v of await query<any>(db, `SELECT id, make, model, plate_number, color FROM vehicles_records WHERE make LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR plate_number LIKE ? ESCAPE '\\' OR vin LIKE ? ESCAPE '\\' LIMIT 8`, term, term, term, term))
      results.push({ id: v.id, type: 'vehicle', label: `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.replace(/\s+/g, ' ').trim() });
  } catch (err: any) { console.error('[Connections] vehicles search error:', err?.message); }

  try {
    for (const p of await query<any>(db, `SELECT id, name FROM properties WHERE name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' LIMIT 8`, term, term))
      results.push({ id: p.id, type: 'property', label: p.name });
  } catch (err: any) { console.error('[Connections] properties search error:', err?.message); }

  try {
    for (const r of await query<any>(db, `SELECT id, case_number, title FROM cases WHERE case_number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' LIMIT 8`, term, term))
      results.push({ id: r.id, type: 'case', label: `${r.case_number} - ${r.title}` });
  } catch (err: any) { console.error('[Connections] cases search error:', err?.message); }

  try {
    for (const i of await query<any>(db, `SELECT id, incident_number, incident_type FROM incidents WHERE incident_number LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\' OR location_address LIKE ? ESCAPE '\\' LIMIT 8`, term, term, term))
      results.push({ id: i.id, type: 'incident', label: `${i.incident_number || ''} ${i.incident_type}`.trim() });
  } catch (err: any) { console.error('[Connections] incidents search error:', err?.message); }

  // Calls for service — searchable so an analyst can seed a graph on a CFS.
  try {
    for (const cf of await query<any>(db, `SELECT id, call_number, incident_type, status FROM calls_for_service WHERE call_number LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\' OR location_address LIKE ? ESCAPE '\\' LIMIT 8`, term, term, term))
      results.push({ id: cf.id, type: 'call', label: `${cf.call_number || `CFS-${cf.id}`} ${cf.incident_type || ''} (${(cf.status || '?').toUpperCase()})`.replace(/\s+/g, ' ').trim() });
  } catch (err: any) { console.error('[Connections] calls search error:', err?.message); }

  try {
    for (const w of await query<any>(db, `SELECT id, warrant_number, status FROM warrants WHERE warrant_number LIKE ? ESCAPE '\\' OR subject_name LIKE ? ESCAPE '\\' LIMIT 8`, term, term))
      results.push({ id: w.id, type: 'warrant', label: `${w.warrant_number || `W-${w.id}`} (${w.status || '?'})` });
  } catch (err: any) { console.error('[Connections] warrants search error:', err?.message); }

  try {
    for (const e of await query<any>(db, `SELECT id, evidence_number, description FROM evidence WHERE evidence_number LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' LIMIT 8`, term, term))
      results.push({ id: e.id, type: 'evidence', label: `${e.evidence_number || ''} ${e.description || ''}`.trim() });
  } catch (err: any) { console.error('[Connections] evidence search error:', err?.message); }

  return c.json(results);
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
  if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

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
  if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

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
  if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

  const db = getDb(c.env);
  const row = await queryFirst<any>(db, 'SELECT user_id FROM connection_investigations WHERE id = ?', id);
  if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
  if (row.user_id !== userId) return c.json({ error: 'Only owner can delete', code: 'INV_NOT_OWNER' }, 403);

  await execute(db, 'DELETE FROM connection_investigations WHERE id = ?', id);
  await audit(c, 'DELETE', 'connection_investigation', id, 'Investigation deleted');
  return c.json({ success: true });
});

export default connections;
