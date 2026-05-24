import { Hono } from 'hono';
import type { Env } from '../worker';
import type { JwtPayload } from '../worker-middleware/auth';
import { authenticateToken, requireRole } from '../worker-middleware/auth';
import { D1Db, paramNum } from '../worker-middleware/d1Helpers';

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

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

async function getRecordLabel(db: D1Db, type: string, id: number): Promise<string> {
  switch (type) {
    case 'person': {
      const p = await db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(id) as any;
      return p ? `${p.first_name} ${p.last_name}` : `Person #${id}`;
    }
    case 'vehicle': {
      const v = await db.prepare('SELECT make, model, plate_number, color FROM vehicles_records WHERE id = ?').get(id) as any;
      return v ? `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() : `Vehicle #${id}`;
    }
    case 'property': {
      const pr = await db.prepare('SELECT name FROM properties WHERE id = ?').get(id) as any;
      return pr ? pr.name : `Property #${id}`;
    }
    case 'evidence': {
      const e = await db.prepare('SELECT evidence_number, description FROM evidence WHERE id = ?').get(id) as any;
      return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() : `Evidence #${id}`;
    }
    case 'case': {
      const c = await db.prepare('SELECT case_number, title FROM cases WHERE id = ?').get(id) as any;
      return c ? `${c.case_number} - ${c.title}` : `Case #${id}`;
    }
    case 'incident': {
      const i = await db.prepare('SELECT incident_number, incident_type FROM incidents WHERE id = ?').get(id) as any;
      return i ? `${i.incident_number || ''} ${i.incident_type}`.trim() : `Incident #${id}`;
    }
    case 'warrant': {
      const w = await db.prepare('SELECT warrant_number, status FROM warrants WHERE id = ?').get(id) as any;
      return w ? `${w.warrant_number || `W-${id}`} (${w.status || '?'})` : `Warrant #${id}`;
    }
    case 'citation': {
      const c = await db.prepare('SELECT citation_number, status FROM citations WHERE id = ?').get(id) as any;
      return c ? `${c.citation_number || `CIT-${id}`} (${c.status || '?'})` : `Citation #${id}`;
    }
    case 'arrest': {
      const a = await db.prepare('SELECT first_name, last_name, booking_date FROM arrest_records WHERE id = ?').get(id) as any;
      return a ? `${a.first_name || ''} ${a.last_name || ''} arr. ${a.booking_date || ''}`.trim() : `Arrest #${id}`;
    }
    case 'field_interview': {
      const f = await db.prepare('SELECT fi_number, location FROM field_interviews WHERE id = ?').get(id) as any;
      return f ? `${f.fi_number || `FI-${id}`}${f.location ? ` @ ${f.location}` : ''}` : `FI #${id}`;
    }
    case 'trespass_order': {
      const t = await db.prepare('SELECT order_number, status FROM trespass_orders WHERE id = ?').get(id) as any;
      return t ? `${t.order_number || `TO-${id}`} (${(t.status || 'unknown').toUpperCase()})` : `Trespass #${id}`;
    }
    case 'serve_job': {
      const s = await db.prepare('SELECT sm_job_id, case_number, document_type, status FROM serve_queue WHERE id = ?').get(id) as any;
      if (!s) return `Serve #${id}`;
      const ref = s.sm_job_id ? `SM-${s.sm_job_id}` : s.case_number || `SJ-${id}`;
      return `${ref}${s.document_type ? ` ${s.document_type}` : ''} (${(s.status || 'pending').toUpperCase()})`;
    }
    default:
      return `${type} #${id}`;
  }
}

async function getNodeMetadata(db: D1Db, type: string, id: number): Promise<Record<string, any>> {
  switch (type) {
    case 'person': {
      const p = await db.prepare('SELECT first_name, last_name, dob, address, city, state, phone, flags FROM persons WHERE id = ?').get(id) as any;
      return p || {};
    }
    case 'vehicle': {
      const v = await db.prepare('SELECT plate_number, state, make, model, year, color, vin, owner_person_id, flags FROM vehicles_records WHERE id = ?').get(id) as any;
      return v || {};
    }
    case 'property': {
      const pr = await db.prepare('SELECT name, address, property_type, client_id FROM properties WHERE id = ?').get(id) as any;
      return pr || {};
    }
    case 'evidence': {
      const e = await db.prepare('SELECT evidence_number, description, evidence_type, status, incident_id FROM evidence WHERE id = ?').get(id) as any;
      return e || {};
    }
    case 'case': {
      const c = await db.prepare('SELECT case_number, title, case_type, status, priority FROM cases WHERE id = ?').get(id) as any;
      return c || {};
    }
    case 'incident': {
      const i = await db.prepare('SELECT incident_number, incident_type, status, priority, location_address FROM incidents WHERE id = ?').get(id) as any;
      return i || {};
    }
    case 'warrant': {
      const w = await db.prepare('SELECT warrant_number, status, type, offense_level, subject_person_id, charge_description FROM warrants WHERE id = ?').get(id) as any;
      return w || {};
    }
    case 'citation': {
      const c = await db.prepare('SELECT citation_number, type, status, person_id, vehicle_id, violation_date, violation_description, offense_level, fine_amount FROM citations WHERE id = ?').get(id) as any;
      return c || {};
    }
    case 'arrest': {
      const a = await db.prepare('SELECT first_name, last_name, booking_date, charges, status, county, source_name FROM arrest_records WHERE id = ?').get(id) as any;
      return a || {};
    }
    case 'field_interview': {
      const f = await db.prepare('SELECT fi_number, person_id, location, contact_reason, contact_type, action_taken, officer_name, status, created_at FROM field_interviews WHERE id = ?').get(id) as any;
      return f || {};
    }
    case 'trespass_order': {
      const t = await db.prepare('SELECT order_number, person_id, property_id, location, status, order_type, effective_date, expiration_date, issued_by_name FROM trespass_orders WHERE id = ?').get(id) as any;
      return t || {};
    }
    case 'serve_job': {
      const s = await db.prepare('SELECT sm_job_id, officer_id, recipient_name, recipient_address, recipient_city, recipient_state, recipient_zip, document_type, case_number, court_name, client_name, attorney_name, priority, deadline, status, attempt_count, recipient_person_id, property_id, serve_date FROM serve_queue WHERE id = ?').get(id) as any;
      return s || {};
    }
    default:
      return {};
  }
}

async function findConnections(db: D1Db, type: string, id: number): Promise<Connection[]> {
  const results: Connection[] = [];

  try {
    const links = await db.prepare(`
      SELECT source_type, source_id, target_type, target_id, relationship
      FROM record_links
      WHERE (source_type = ? AND source_id = ?)
         OR (target_type = ? AND target_id = ?)
      LIMIT 1000
    `).all(type, id, type, id) as any[];

    for (const link of links) {
      const isSource = link.source_type === type && link.source_id === id;
      results.push({
        type: isSource ? link.target_type : link.source_type,
        id: isSource ? link.target_id : link.source_id,
        relationship: link.relationship,
        sourceTable: 'record_links',
      });
    }
  } catch { /* record_links table may not exist */ }

  try {
    switch (type) {
      case 'person': {
        const incPersons = await db.prepare('SELECT incident_id, role FROM incident_persons WHERE person_id = ?').all(id) as any[];
        for (const ip of incPersons) {
          results.push({ type: 'incident', id: ip.incident_id, relationship: ip.role, sourceTable: 'incident_persons' });
        }

        const callPersons = await db.prepare(`
          SELECT cp.call_id, cp.role, i.id as incident_id
          FROM call_persons cp
          LEFT JOIN incidents i ON i.call_id = cp.call_id
          WHERE cp.person_id = ?
          LIMIT 1000
        `).all(id) as any[];
        for (const cp of callPersons) {
          if (cp.incident_id) {
            results.push({ type: 'incident', id: cp.incident_id, relationship: cp.role, sourceTable: 'call_persons' });
          }
        }

        const ownedVehicles = await db.prepare('SELECT id FROM vehicles_records WHERE owner_person_id = ?').all(id) as any[];
        for (const v of ownedVehicles) {
          results.push({ type: 'vehicle', id: v.id, relationship: 'owner', sourceTable: 'vehicles_records' });
        }

        try {
          const caseLinks = await db.prepare("SELECT case_id FROM case_person_links WHERE person_id = ?").all(id) as any[];
          for (const c of caseLinks) {
            results.push({ type: 'case', id: c.case_id, relationship: 'linked', sourceTable: 'case_person_links' });
          }
        } catch { /* table may not exist */ }

        const clientPersons = await db.prepare(`
          SELECT cp.relationship, p.id as property_id
          FROM client_persons cp
          JOIN properties p ON p.client_id = cp.client_id
          WHERE cp.person_id = ?
          LIMIT 1000
        `).all(id) as any[];
        for (const cp of clientPersons) {
          results.push({ type: 'property', id: cp.property_id, relationship: cp.relationship, sourceTable: 'client_persons' });
        }

        try {
          const warrants = await db.prepare("SELECT id, status FROM warrants WHERE subject_person_id = ?").all(id) as any[];
          for (const w of warrants) {
            results.push({ type: 'warrant', id: w.id, relationship: `warrant_${(w.status || '').toLowerCase()}`, sourceTable: 'warrants' });
          }
        } catch { /* table may not exist */ }

        try {
          const citations = await db.prepare("SELECT id, status FROM citations WHERE person_id = ?").all(id) as any[];
          for (const c of citations) {
            results.push({ type: 'citation', id: c.id, relationship: `citation_${(c.status || '').toLowerCase()}`, sourceTable: 'citations' });
          }
        } catch { /* table may not exist */ }

        try {
          const arrests = await db.prepare("SELECT arrest_record_id FROM arrest_cross_links WHERE linked_type = 'person' AND linked_id = ?").all(id) as any[];
          for (const a of arrests) {
            results.push({ type: 'arrest', id: a.arrest_record_id, relationship: 'arrested', sourceTable: 'arrest_cross_links' });
          }
        } catch { /* table may not exist */ }

        try {
          const fis = await db.prepare("SELECT id FROM field_interviews WHERE person_id = ?").all(id) as any[];
          for (const f of fis) {
            results.push({ type: 'field_interview', id: f.id, relationship: 'fi_contact', sourceTable: 'field_interviews' });
          }
        } catch { /* table may not exist */ }

        try {
          const tos = await db.prepare("SELECT id, status FROM trespass_orders WHERE person_id = ?").all(id) as any[];
          for (const t of tos) {
            results.push({ type: 'trespass_order', id: t.id, relationship: 'trespassed_from', sourceTable: 'trespass_orders' });
          }
        } catch { /* table may not exist */ }

        try {
          const sjs = await db.prepare("SELECT id FROM serve_queue WHERE recipient_person_id = ?").all(id) as any[];
          for (const s of sjs) {
            results.push({ type: 'serve_job', id: s.id, relationship: 'serve_recipient', sourceTable: 'serve_queue' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'vehicle': {
        try {
          const incVehicles = await db.prepare('SELECT incident_id, role FROM incident_vehicles WHERE vehicle_id = ?').all(id) as any[];
          for (const iv of incVehicles) {
            results.push({ type: 'incident', id: iv.incident_id, relationship: iv.role, sourceTable: 'incident_vehicles' });
          }
        } catch { /* table may not exist */ }

        try {
          const callVehicles = await db.prepare(`
            SELECT cv.call_id, cv.role, i.id as incident_id
            FROM call_vehicles cv
            LEFT JOIN incidents i ON i.call_id = cv.call_id
            WHERE cv.vehicle_id = ?
            LIMIT 1000
          `).all(id) as any[];
          for (const cv of callVehicles) {
            if (cv.incident_id) {
              results.push({ type: 'incident', id: cv.incident_id, relationship: cv.role, sourceTable: 'call_vehicles' });
            }
          }
        } catch { /* table may not exist */ }

        try {
          const vehicle = await db.prepare('SELECT owner_person_id FROM vehicles_records WHERE id = ?').get(id) as any;
          if (vehicle?.owner_person_id) {
            results.push({ type: 'person', id: vehicle.owner_person_id, relationship: 'owner', sourceTable: 'vehicles_records' });
          }
        } catch { /* table may not exist */ }

        try {
          const citations = await db.prepare("SELECT id, status FROM citations WHERE vehicle_id = ?").all(id) as any[];
          for (const c of citations) {
            results.push({ type: 'citation', id: c.id, relationship: `citation_${(c.status || '').toLowerCase()}`, sourceTable: 'citations' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'incident': {
        const personsInInc = await db.prepare('SELECT person_id, role FROM incident_persons WHERE incident_id = ?').all(id) as any[];
        for (const ip of personsInInc) {
          results.push({ type: 'person', id: ip.person_id, relationship: ip.role, sourceTable: 'incident_persons' });
        }

        const vehiclesInInc = await db.prepare('SELECT vehicle_id, role FROM incident_vehicles WHERE incident_id = ?').all(id) as any[];
        for (const iv of vehiclesInInc) {
          results.push({ type: 'vehicle', id: iv.vehicle_id, relationship: iv.role, sourceTable: 'incident_vehicles' });
        }

        const evidenceInInc = await db.prepare('SELECT id FROM evidence WHERE incident_id = ?').all(id) as any[];
        for (const e of evidenceInInc) {
          results.push({ type: 'evidence', id: e.id, relationship: 'collected_from', sourceTable: 'evidence' });
        }

        const inc = await db.prepare('SELECT property_id FROM incidents WHERE id = ?').get(id) as any;
        if (inc?.property_id) {
          results.push({ type: 'property', id: inc.property_id, relationship: 'location', sourceTable: 'incidents' });
        }

        try {
          const caseLinks = await db.prepare("SELECT case_id FROM case_incident_links WHERE incident_id = ?").all(id) as any[];
          for (const c of caseLinks) {
            results.push({ type: 'case', id: c.case_id, relationship: 'linked', sourceTable: 'case_incident_links' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'case': {
        try {
          const persons = await db.prepare("SELECT person_id FROM case_person_links WHERE case_id = ?").all(id) as any[];
          for (const r of persons) {
            results.push({ type: 'person', id: r.person_id, relationship: 'linked', sourceTable: 'case_person_links' });
          }
        } catch { /* table may not exist */ }
        try {
          const incidents = await db.prepare("SELECT incident_id FROM case_incident_links WHERE case_id = ?").all(id) as any[];
          for (const r of incidents) {
            results.push({ type: 'incident', id: r.incident_id, relationship: 'linked', sourceTable: 'case_incident_links' });
          }
        } catch { /* table may not exist */ }
        try {
          const evidence = await db.prepare("SELECT evidence_id FROM case_evidence_links WHERE case_id = ?").all(id) as any[];
          for (const r of evidence) {
            results.push({ type: 'evidence', id: r.evidence_id, relationship: 'linked', sourceTable: 'case_evidence_links' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'property': {
        const propIncidents = await db.prepare('SELECT id FROM incidents WHERE property_id = ?').all(id) as any[];
        for (const pi of propIncidents) {
          results.push({ type: 'incident', id: pi.id, relationship: 'location', sourceTable: 'incidents' });
        }

        const prop = await db.prepare('SELECT client_id FROM properties WHERE id = ?').get(id) as any;
        if (prop?.client_id) {
          const cpRows = await db.prepare('SELECT person_id, relationship FROM client_persons WHERE client_id = ?').all(prop.client_id) as any[];
          for (const cp of cpRows) {
            results.push({ type: 'person', id: cp.person_id, relationship: cp.relationship, sourceTable: 'client_persons' });
          }
        }

        try {
          const tos = await db.prepare("SELECT id, status FROM trespass_orders WHERE property_id = ?").all(id) as any[];
          for (const t of tos) {
            results.push({ type: 'trespass_order', id: t.id, relationship: 'trespass_on_location', sourceTable: 'trespass_orders' });
          }
        } catch { /* table may not exist */ }

        try {
          const sjs = await db.prepare("SELECT id FROM serve_queue WHERE property_id = ?").all(id) as any[];
          for (const s of sjs) {
            results.push({ type: 'serve_job', id: s.id, relationship: 'serve_location', sourceTable: 'serve_queue' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'evidence': {
        const evRow = await db.prepare('SELECT incident_id FROM evidence WHERE id = ?').get(id) as any;
        if (evRow?.incident_id) {
          results.push({ type: 'incident', id: evRow.incident_id, relationship: 'collected_from', sourceTable: 'evidence' });
        }

        try {
          const caseLinks = await db.prepare("SELECT case_id FROM case_evidence_links WHERE evidence_id = ?").all(id) as any[];
          for (const c of caseLinks) {
            results.push({ type: 'case', id: c.case_id, relationship: 'linked', sourceTable: 'case_evidence_links' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'warrant': {
        try {
          const w = await db.prepare('SELECT subject_person_id FROM warrants WHERE id = ?').get(id) as any;
          if (w?.subject_person_id) {
            results.push({ type: 'person', id: w.subject_person_id, relationship: 'subject', sourceTable: 'warrants' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'citation': {
        try {
          const c = await db.prepare('SELECT person_id, vehicle_id FROM citations WHERE id = ?').get(id) as any;
          if (c?.person_id) {
            results.push({ type: 'person', id: c.person_id, relationship: 'subject', sourceTable: 'citations' });
          }
          if (c?.vehicle_id) {
            results.push({ type: 'vehicle', id: c.vehicle_id, relationship: 'cited_vehicle', sourceTable: 'citations' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'arrest': {
        try {
          const rows = await db.prepare("SELECT linked_type, linked_id FROM arrest_cross_links WHERE arrest_record_id = ? AND linked_type = 'person'").all(id) as any[];
          for (const r of rows) {
            results.push({ type: 'person', id: r.linked_id, relationship: 'arrestee', sourceTable: 'arrest_cross_links' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'field_interview': {
        try {
          const f = await db.prepare('SELECT person_id FROM field_interviews WHERE id = ?').get(id) as any;
          if (f?.person_id) {
            results.push({ type: 'person', id: f.person_id, relationship: 'subject', sourceTable: 'field_interviews' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'trespass_order': {
        try {
          const t = await db.prepare('SELECT person_id, property_id FROM trespass_orders WHERE id = ?').get(id) as any;
          if (t?.person_id) {
            results.push({ type: 'person', id: t.person_id, relationship: 'subject', sourceTable: 'trespass_orders' });
          }
          if (t?.property_id) {
            results.push({ type: 'property', id: t.property_id, relationship: 'location', sourceTable: 'trespass_orders' });
          }
        } catch { /* table may not exist */ }
        break;
      }

      case 'serve_job': {
        try {
          const s = await db.prepare('SELECT recipient_person_id, property_id FROM serve_queue WHERE id = ?').get(id) as any;
          if (s?.recipient_person_id) {
            results.push({ type: 'person', id: s.recipient_person_id, relationship: 'recipient', sourceTable: 'serve_queue' });
          }
          if (s?.property_id) {
            results.push({ type: 'property', id: s.property_id, relationship: 'location', sourceTable: 'serve_queue' });
          }
        } catch { /* table may not exist */ }
        break;
      }
    }
  } catch { /* junction table query error */ }

  return results;
}

const MAX_NODES = 200;

async function buildGraph(db: D1Db, seedType: string, seedId: number, maxDepth: number = 2): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
  const nodeMap = new Map<string, GNode>();
  const edgeSet = new Set<string>();
  const edges: GEdge[] = [];
  const queue: Array<{ type: string; id: number; depth: number }> = [];

  const labelCache = new Map<string, string>();
  const metadataCache = new Map<string, Record<string, any>>();

  function nodeKey(type: string, id: number): string { return `${type}-${id}`; }

  async function cachedLabel(type: string, id: number): Promise<string> {
    const k = nodeKey(type, id);
    const hit = labelCache.get(k);
    if (hit !== undefined) return hit;
    const miss = await getRecordLabel(db, type, id);
    labelCache.set(k, miss);
    return miss;
  }

  async function cachedMetadata(type: string, id: number): Promise<Record<string, any>> {
    const k = nodeKey(type, id);
    const hit = metadataCache.get(k);
    if (hit !== undefined) return hit;
    const miss = await getNodeMetadata(db, type, id);
    metadataCache.set(k, miss);
    return miss;
  }

  async function addNode(type: string, id: number, depth: number): Promise<boolean> {
    if (nodeMap.size >= MAX_NODES) return false;
    const key = nodeKey(type, id);
    if (nodeMap.has(key)) return false;
    const [label, metadata] = await Promise.all([cachedLabel(type, id), cachedMetadata(type, id)]);
    nodeMap.set(key, { id: key, type, entityId: id, label, metadata, depth });
    return true;
  }

  function addEdge(srcType: string, srcId: number, tgtType: string, tgtId: number, relationship: string, sourceTable: string): void {
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
    const connections = await findConnections(db, current.type, current.id);

    for (const conn of connections) {
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

const PATH_MAX_DEPTH = 6;

async function findShortestPath(db: D1Db, fromType: string, fromId: number, toType: string, toId: number): Promise<{ path: GNode[]; edges: GEdge[] } | null> {
  const fromKey = `${fromType}-${fromId}`;
  const toKey = `${toType}-${toId}`;

  if (fromKey === toKey) {
    const [label, metadata] = await Promise.all([getRecordLabel(db, fromType, fromId), getNodeMetadata(db, fromType, fromId)]);
    return {
      path: [{ id: fromKey, type: fromType, entityId: fromId, label, metadata, depth: 0 }],
      edges: [],
    };
  }

  type Entry = { key: string; type: string; id: number; parent: string | null; rel: string; srcTable: string; depth: number };
  const visited = new Map<string, Entry>();
  visited.set(fromKey, { key: fromKey, type: fromType, id: fromId, parent: null, rel: '', srcTable: '', depth: 0 });
  const queue: Entry[] = [visited.get(fromKey)!];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= PATH_MAX_DEPTH) continue;

    const connections = await findConnections(db, current.type, current.id);
    for (const conn of connections) {
      const ckey = `${conn.type}-${conn.id}`;
      if (visited.has(ckey)) continue;
      const entry: Entry = { key: ckey, type: conn.type, id: conn.id, parent: current.key, rel: conn.relationship, srcTable: conn.sourceTable, depth: current.depth + 1 };
      visited.set(ckey, entry);

      if (ckey === toKey) {
        const chain: Entry[] = [];
        let cur: Entry | undefined = entry;
        while (cur) { chain.unshift(cur); cur = cur.parent ? visited.get(cur.parent) : undefined; }
        const path: GNode[] = await Promise.all(chain.map(async e => {
          const [label, metadata] = await Promise.all([getRecordLabel(db, e.type, e.id), getNodeMetadata(db, e.type, e.id)]);
          return { id: e.key, type: e.type, entityId: e.id, label, metadata, depth: e.depth };
        }));
        const edges: GEdge[] = chain.slice(1).map(e => ({ source: e.parent!, target: e.key, relationship: e.rel, sourceTable: e.srcTable }));
        return { path, edges };
      }

      queue.push(entry);
    }
  }

  return null;
}

const VALID_TYPES = ['person', 'vehicle', 'property', 'evidence', 'case', 'incident', 'warrant', 'citation', 'arrest', 'field_interview', 'trespass_order', 'serve_job'];

export function mountConnectionsRoutes(app: Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>): void {
  const api = new Hono<{ Bindings: Env; Variables: { user: JwtPayload } }>();
  api.use('/*', authenticateToken);

  // GET /connections/graph?type=person&id=123&depth=2
  api.get('/graph', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { type, id, depth } = q;

      if (!type || !id) { return c.json({ error: 'type and id query parameters are required', code: 'TYPE_AND_ID_QUERY' }, 400); }
      if (!VALID_TYPES.includes(String(type))) { return c.json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` }, 400); }
      if (isNaN(Number(id)) || Number(id) < 1) { return c.json({ error: 'id must be a positive integer', code: 'ID_MUST_BE_A' }, 400); }

      const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);
      const graph = await buildGraph(db, String(type), Number(id), maxDepth);
      return c.json(graph);
    } catch {
      return c.json({ error: 'Failed to build connection graph', code: 'FAILED_TO_BUILD_CONNECTION' }, 500);
    }
  });

  // GET /connections/path?fromType=X&fromId=Y&toType=A&toId=B
  api.get('/path', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const { fromType, fromId, toType, toId } = q;

      if (!fromType || !fromId || !toType || !toId) { return c.json({ error: 'fromType, fromId, toType, and toId are all required', code: 'PATH_PARAMS_REQUIRED' }, 400); }
      if (!VALID_TYPES.includes(String(fromType))) { return c.json({ error: `Invalid fromType. Must be one of: ${VALID_TYPES.join(', ')}` }, 400); }
      if (!VALID_TYPES.includes(String(toType))) { return c.json({ error: `Invalid toType. Must be one of: ${VALID_TYPES.join(', ')}` }, 400); }
      if (isNaN(Number(fromId)) || Number(fromId) < 1 || isNaN(Number(toId)) || Number(toId) < 1) { return c.json({ error: 'fromId and toId must be positive integers' }, 400); }

      const result = findShortestPath(db, String(fromType), Number(fromId), String(toType), Number(toId));
      if (!result) { return c.json({ error: `No path found within ${PATH_MAX_DEPTH} hops`, code: 'NO_PATH' }, 404); }
      return c.json(result);
    } catch {
      return c.json({ error: 'Failed to find path', code: 'PATH_FAILED' }, 500);
    }
  });

  // GET /connections/search?q=term
  api.get('/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const q = c.req.query();
      const query = q.q;

      if (!query || String(query).trim().length < 2) { return c.json([]); }

      const term = `%${escapeLike(String(query).trim())}%`;
      const results: Array<{ id: number; type: string; label: string }> = [];

      try {
        const persons = await db.prepare(`
          SELECT id, first_name, last_name FROM persons
          WHERE first_name LIKE ? OR last_name LIKE ? OR (first_name || ' ' || last_name) LIKE ?
          LIMIT 8
        `).all(term, term, term) as any[];
        results.push(...persons.map((p: any) => ({ id: p.id, type: 'person', label: `${p.first_name} ${p.last_name}` })));
      } catch { /* table may not exist */ }

      try {
        const vehicles = await db.prepare(`
          SELECT id, make, model, plate_number, color FROM vehicles_records
          WHERE make LIKE ? OR model LIKE ? OR plate_number LIKE ? OR vin LIKE ?
          LIMIT 8
        `).all(term, term, term, term) as any[];
        results.push(...vehicles.map((v: any) => ({ id: v.id, type: 'vehicle', label: `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() })));
      } catch { /* table may not exist */ }

      try {
        const properties = await db.prepare(`
          SELECT id, name, address FROM properties
          WHERE name LIKE ? OR address LIKE ?
          LIMIT 8
        `).all(term, term) as any[];
        results.push(...properties.map((p: any) => ({ id: p.id, type: 'property', label: p.name })));
      } catch { /* table may not exist */ }

      try {
        const cases = await db.prepare(`
          SELECT id, case_number, title FROM cases
          WHERE case_number LIKE ? OR title LIKE ?
          LIMIT 8
        `).all(term, term) as any[];
        results.push(...cases.map((c: any) => ({ id: c.id, type: 'case', label: `${c.case_number} - ${c.title}` })));
      } catch { /* table may not exist */ }

      try {
        const incidents = await db.prepare(`
          SELECT id, incident_number, incident_type FROM incidents
          WHERE incident_number LIKE ? OR incident_type LIKE ? OR location_address LIKE ?
          LIMIT 8
        `).all(term, term, term) as any[];
        results.push(...incidents.map((i: any) => ({ id: i.id, type: 'incident', label: `${i.incident_number || ''} ${i.incident_type}`.trim() })));
      } catch { /* table may not exist */ }

      try {
        const evidence = await db.prepare(`
          SELECT id, evidence_number, description FROM evidence
          WHERE evidence_number LIKE ? OR description LIKE ?
          LIMIT 8
        `).all(term, term) as any[];
        results.push(...evidence.map((e: any) => ({ id: e.id, type: 'evidence', label: `${e.evidence_number || ''} ${e.description || ''}`.trim() })));
      } catch { /* table may not exist */ }

      return c.json(results);
    } catch {
      return c.json({ error: 'Search failed', code: 'SEARCH_FAILED' }, 500);
    }
  });

  // ─── INVESTIGATIONS CRUD ────────────────────────────────────
  const INVESTIGATION_ROLES = ['admin', 'manager', 'supervisor', 'officer', 'dispatcher'] as const;

  function canReadInvestigation(inv: any, userId: number): boolean {
    if (inv.user_id === userId) return true;
    try {
      const shared = JSON.parse(inv.shared_user_ids || '[]');
      return Array.isArray(shared) && shared.includes(userId);
    } catch { return false; }
  }

  // POST /connections/investigations
  api.post('/investigations', requireRole(...INVESTIGATION_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

      const body = await c.req.json();
      const { name, description, seed_nodes, pinned_layout, annotations, shared_user_ids } = body || {};
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return c.json({ error: 'name is required', code: 'NAME_REQUIRED' }, 400);
      }

      const info = await db.prepare(
        `INSERT INTO connection_investigations (user_id, name, description, seed_nodes, pinned_layout, annotations, shared_user_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId, name.trim(), description || null,
        JSON.stringify(seed_nodes || []),
        pinned_layout ? JSON.stringify(pinned_layout) : null,
        annotations ? JSON.stringify(annotations) : null,
        JSON.stringify(shared_user_ids || []),
      );

      const created = await db.prepare('SELECT * FROM connection_investigations WHERE id = ?').get(Number(info.meta.last_row_id));
      return c.json(created, 201);
    } catch {
      return c.json({ error: 'Create failed', code: 'INV_CREATE_FAILED' }, 500);
    }
  });

  // GET /connections/investigations
  api.get('/investigations', requireRole(...INVESTIGATION_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

      const sharedPattern = `%,${userId},%`;
      const visible = await db.prepare(
        `SELECT * FROM connection_investigations
         WHERE user_id = ?
            OR ',' || REPLACE(REPLACE(shared_user_ids, '[', ''), ']', '') || ',' LIKE ?
         ORDER BY updated_at DESC
         LIMIT 500`
      ).all(userId, sharedPattern) as any[];

      return c.json(visible);
    } catch {
      return c.json({ error: 'List failed', code: 'INV_LIST_FAILED' }, 500);
    }
  });

  // GET /connections/investigations/:id
  api.get('/investigations/:id', requireRole(...INVESTIGATION_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

      const id = paramNum(c.req.param('id'));
      if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

      const row = await db.prepare('SELECT * FROM connection_investigations WHERE id = ?').get(id) as any;
      if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
      if (!canReadInvestigation(row, userId)) return c.json({ error: 'Forbidden', code: 'INV_FORBIDDEN' }, 403);

      return c.json(row);
    } catch {
      return c.json({ error: 'Read failed', code: 'INV_READ_FAILED' }, 500);
    }
  });

  // PUT /connections/investigations/:id
  api.put('/investigations/:id', requireRole(...INVESTIGATION_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

      const id = paramNum(c.req.param('id'));
      if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

      const row = await db.prepare('SELECT * FROM connection_investigations WHERE id = ?').get(id) as any;
      if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
      if (row.user_id !== userId) return c.json({ error: 'Only owner can update', code: 'INV_NOT_OWNER' }, 403);

      const body = await c.req.json();
      const { name, description, seed_nodes, pinned_layout, annotations, shared_user_ids } = body || {};

      const updates: string[] = [];
      const params: any[] = [];
      if (name !== undefined) { updates.push('name = ?'); params.push(String(name).trim()); }
      if (description !== undefined) { updates.push('description = ?'); params.push(description); }
      if (seed_nodes !== undefined) { updates.push('seed_nodes = ?'); params.push(JSON.stringify(seed_nodes)); }
      if (pinned_layout !== undefined) { updates.push('pinned_layout = ?'); params.push(pinned_layout ? JSON.stringify(pinned_layout) : null); }
      if (annotations !== undefined) { updates.push('annotations = ?'); params.push(annotations ? JSON.stringify(annotations) : null); }
      if (shared_user_ids !== undefined) { updates.push('shared_user_ids = ?'); params.push(JSON.stringify(shared_user_ids)); }
      updates.push('updated_at = CURRENT_TIMESTAMP');

      if (updates.length === 1) return c.json(row);

      params.push(id);
      await db.prepare(`UPDATE connection_investigations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      const updated = await db.prepare('SELECT * FROM connection_investigations WHERE id = ?').get(id);
      return c.json(updated);
    } catch {
      return c.json({ error: 'Update failed', code: 'INV_UPDATE_FAILED' }, 500);
    }
  });

  // DELETE /connections/investigations/:id
  api.delete('/investigations/:id', requireRole(...INVESTIGATION_ROLES), async (c) => {
    try {
      const db = new D1Db(c.env.DB);
      const userId = c.get('user').userId;
      if (!userId) return c.json({ error: 'Unauthenticated' }, 401);

      const id = paramNum(c.req.param('id'));
      if (isNaN(id) || id < 1) return c.json({ error: 'Invalid id' }, 400);

      const row = await db.prepare('SELECT user_id FROM connection_investigations WHERE id = ?').get(id) as any;
      if (!row) return c.json({ error: 'Not found', code: 'INV_NOT_FOUND' }, 404);
      if (row.user_id !== userId) return c.json({ error: 'Only owner can delete', code: 'INV_NOT_OWNER' }, 403);

      await db.prepare('DELETE FROM connection_investigations WHERE id = ?').run(id);
      return c.json({ success: true });
    } catch {
      return c.json({ error: 'Delete failed', code: 'INV_DELETE_FAILED' }, 500);
    }
  });

  // Suggestions feature — stub (requires Node.js-only connectionSuggestions module)
  api.get('/suggestions', requireRole('admin', 'manager', 'supervisor'), async (c) => {
    return c.json({ error: 'Suggestions not available in Workers runtime', stub: true }, 501);
  });

  app.route('/api/connections', api);
}
