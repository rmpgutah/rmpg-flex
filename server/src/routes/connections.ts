// ============================================================
// RMPG Flex — Connection Analysis API
// ============================================================
// Graph traversal for visualizing relationships between
// persons, vehicles, properties, cases, incidents, and evidence.
// Uses BFS across record_links + all junction tables.
// ============================================================

import { Router, Request, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { escapeLike } from '../middleware/sanitize';
import { sendCsv } from '../utils/csvExport';
import { auditLog } from '../utils/auditLogger';

const router = Router();
router.use(authenticateToken);

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

// ── Helpers ──────────────────────────────────────────────────

function getRecordLabel(db: any, type: string, id: number): string {
  try {
    switch (type) {
      case 'person': {
        const p = db.prepare('SELECT first_name, last_name FROM persons WHERE id = ?').get(id) as any;
        return p ? `${p.first_name} ${p.last_name}` : `Person #${id}`;
      }
      case 'vehicle': {
        const v = db.prepare('SELECT make, model, plate_number, color FROM vehicles_records WHERE id = ?').get(id) as any;
        return v ? `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() : `Vehicle #${id}`;
      }
      case 'property': {
        const pr = db.prepare('SELECT name FROM properties WHERE id = ?').get(id) as any;
        return pr ? pr.name : `Property #${id}`;
      }
      case 'evidence': {
        const e = db.prepare('SELECT evidence_number, description FROM evidence WHERE id = ?').get(id) as any;
        return e ? `${e.evidence_number || ''} ${e.description || ''}`.trim() : `Evidence #${id}`;
      }
      case 'case': {
        const c = db.prepare('SELECT case_number, title FROM cases WHERE id = ?').get(id) as any;
        return c ? `${c.case_number} - ${c.title}` : `Case #${id}`;
      }
      case 'incident': {
        const i = db.prepare('SELECT incident_number, incident_type FROM incidents WHERE id = ?').get(id) as any;
        return i ? `${i.incident_number || ''} ${i.incident_type}`.trim() : `Incident #${id}`;
      }
      default:
        return `${type} #${id}`;
    }
  } catch (err: any) {
    console.error('[Connections] getRecordLabel error:', err?.message);
    return `${type} #${id}`;
  }
}

function getNodeMetadata(db: any, type: string, id: number): Record<string, any> {
  try {
    switch (type) {
      case 'person': {
        const p = db.prepare('SELECT first_name, last_name, dob, address, city, state, phone, flags FROM persons WHERE id = ?').get(id) as any;
        return p || {};
      }
      case 'vehicle': {
        const v = db.prepare('SELECT plate_number, state, make, model, year, color, vin, owner_person_id, flags FROM vehicles_records WHERE id = ?').get(id) as any;
        return v || {};
      }
      case 'property': {
        const pr = db.prepare('SELECT name, address, property_type, client_id FROM properties WHERE id = ?').get(id) as any;
        return pr || {};
      }
      case 'evidence': {
        const e = db.prepare('SELECT evidence_number, description, evidence_type, status, incident_id FROM evidence WHERE id = ?').get(id) as any;
        return e || {};
      }
      case 'case': {
        const c = db.prepare('SELECT case_number, title, case_type, status, priority FROM cases WHERE id = ?').get(id) as any;
        return c || {};
      }
      case 'incident': {
        const i = db.prepare('SELECT incident_number, incident_type, status, priority, location_address FROM incidents WHERE id = ?').get(id) as any;
        return i || {};
      }
      default:
        return {};
    }
  } catch (err: any) {
    console.error('[Connections] getNodeMetadata error:', err?.message);
    return {};
  }
}

// ── Connection Discovery ─────────────────────────────────────

function findConnections(db: any, type: string, id: number): Connection[] {
  const results: Connection[] = [];

  // 1. record_links (bidirectional)
  try {
    const links = db.prepare(`
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
  } catch (err: any) { /* record_links table may not exist */ console.error('[Connections] record_links query error:', err?.message); }

  // 2. Type-specific junction tables
  try {
    switch (type) {
      case 'person': {
        // incident_persons → incidents
        const incPersons = db.prepare('SELECT incident_id, role FROM incident_persons WHERE person_id = ?').all(id) as any[];
        for (const ip of incPersons) {
          results.push({ type: 'incident', id: ip.incident_id, relationship: ip.role, sourceTable: 'incident_persons' });
        }

        // call_persons → incidents (via call_id)
        const callPersons = db.prepare(`
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

        // vehicles_records.owner_person_id → vehicles
        const ownedVehicles = db.prepare('SELECT id FROM vehicles_records WHERE owner_person_id = ?').all(id) as any[];
        for (const v of ownedVehicles) {
          results.push({ type: 'vehicle', id: v.id, relationship: 'owner', sourceTable: 'vehicles_records' });
        }

        // cases.linked_persons (JSON array) → cases
        const casesWithPerson = db.prepare("SELECT id, linked_persons FROM cases WHERE linked_persons LIKE ?").all(`%${escapeLike(String(id))}%`) as any[];
        for (const c of casesWithPerson) {
          try {
            const linkedIds = JSON.parse(c.linked_persons || '[]');
            if (linkedIds.includes(id) || linkedIds.includes(String(id))) {
              results.push({ type: 'case', id: c.id, relationship: 'linked', sourceTable: 'cases' });
            }
          } catch { /* skip malformed JSON */ }
        }

        // client_persons → properties (via client_id)
        const clientPersons = db.prepare(`
          SELECT cp.relationship, p.id as property_id
          FROM client_persons cp
          JOIN properties p ON p.client_id = cp.client_id
          WHERE cp.person_id = ?
        
          LIMIT 1000
        `).all(id) as any[];
        for (const cp of clientPersons) {
          results.push({ type: 'property', id: cp.property_id, relationship: cp.relationship, sourceTable: 'client_persons' });
        }
        break;
      }

      case 'vehicle': {
        // incident_vehicles → incidents
        const incVehicles = db.prepare('SELECT incident_id, role FROM incident_vehicles WHERE vehicle_id = ?').all(id) as any[];
        for (const iv of incVehicles) {
          results.push({ type: 'incident', id: iv.incident_id, relationship: iv.role, sourceTable: 'incident_vehicles' });
        }

        // call_vehicles → incidents (via call_id)
        const callVehicles = db.prepare(`
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

        // owner → person
        const vehicle = db.prepare('SELECT owner_person_id FROM vehicles_records WHERE id = ?').get(id) as any;
        if (vehicle?.owner_person_id) {
          results.push({ type: 'person', id: vehicle.owner_person_id, relationship: 'owner', sourceTable: 'vehicles_records' });
        }
        break;
      }

      case 'incident': {
        // incident_persons → persons
        const personsInInc = db.prepare('SELECT person_id, role FROM incident_persons WHERE incident_id = ?').all(id) as any[];
        for (const ip of personsInInc) {
          results.push({ type: 'person', id: ip.person_id, relationship: ip.role, sourceTable: 'incident_persons' });
        }

        // incident_vehicles → vehicles
        const vehiclesInInc = db.prepare('SELECT vehicle_id, role FROM incident_vehicles WHERE incident_id = ?').all(id) as any[];
        for (const iv of vehiclesInInc) {
          results.push({ type: 'vehicle', id: iv.vehicle_id, relationship: iv.role, sourceTable: 'incident_vehicles' });
        }

        // evidence.incident_id → evidence
        const evidenceInInc = db.prepare('SELECT id FROM evidence WHERE incident_id = ?').all(id) as any[];
        for (const e of evidenceInInc) {
          results.push({ type: 'evidence', id: e.id, relationship: 'collected_from', sourceTable: 'evidence' });
        }

        // incidents.property_id → property
        const inc = db.prepare('SELECT property_id FROM incidents WHERE id = ?').get(id) as any;
        if (inc?.property_id) {
          results.push({ type: 'property', id: inc.property_id, relationship: 'location', sourceTable: 'incidents' });
        }

        // cases.linked_incidents (JSON array) → cases
        const casesWithInc = db.prepare("SELECT id, linked_incidents FROM cases WHERE linked_incidents LIKE ?").all(`%${escapeLike(String(id))}%`) as any[];
        for (const c of casesWithInc) {
          try {
            const linkedIds = JSON.parse(c.linked_incidents || '[]');
            if (linkedIds.includes(id) || linkedIds.includes(String(id))) {
              results.push({ type: 'case', id: c.id, relationship: 'linked', sourceTable: 'cases' });
            }
          } catch { /* skip */ }
        }
        break;
      }

      case 'case': {
        const caseRow = db.prepare('SELECT linked_incidents, linked_persons, linked_evidence FROM cases WHERE id = ?').get(id) as any;
        if (caseRow) {
          // linked_incidents → incidents
          try {
            const incIds = JSON.parse(caseRow.linked_incidents || '[]');
            for (const incId of incIds) {
              results.push({ type: 'incident', id: Number(incId), relationship: 'linked', sourceTable: 'cases' });
            }
          } catch { /* skip */ }

          // linked_persons → persons
          try {
            const personIds = JSON.parse(caseRow.linked_persons || '[]');
            for (const pId of personIds) {
              results.push({ type: 'person', id: Number(pId), relationship: 'linked', sourceTable: 'cases' });
            }
          } catch { /* skip */ }

          // linked_evidence → evidence
          try {
            const evIds = JSON.parse(caseRow.linked_evidence || '[]');
            for (const evId of evIds) {
              results.push({ type: 'evidence', id: Number(evId), relationship: 'linked', sourceTable: 'cases' });
            }
          } catch { /* skip */ }
        }
        break;
      }

      case 'property': {
        // incidents.property_id → incidents
        const propIncidents = db.prepare('SELECT id FROM incidents WHERE property_id = ?').all(id) as any[];
        for (const pi of propIncidents) {
          results.push({ type: 'incident', id: pi.id, relationship: 'location', sourceTable: 'incidents' });
        }

        // client_persons (via client_id) → persons
        const prop = db.prepare('SELECT client_id FROM properties WHERE id = ?').get(id) as any;
        if (prop?.client_id) {
          const cpRows = db.prepare('SELECT person_id, relationship FROM client_persons WHERE client_id = ?').all(prop.client_id) as any[];
          for (const cp of cpRows) {
            results.push({ type: 'person', id: cp.person_id, relationship: cp.relationship, sourceTable: 'client_persons' });
          }
        }
        break;
      }

      case 'evidence': {
        // evidence.incident_id → incident
        const evRow = db.prepare('SELECT incident_id FROM evidence WHERE id = ?').get(id) as any;
        if (evRow?.incident_id) {
          results.push({ type: 'incident', id: evRow.incident_id, relationship: 'collected_from', sourceTable: 'evidence' });
        }

        // cases.linked_evidence (JSON array) → cases
        const casesWithEv = db.prepare("SELECT id, linked_evidence FROM cases WHERE linked_evidence LIKE ?").all(`%${escapeLike(String(id))}%`) as any[];
        for (const c of casesWithEv) {
          try {
            const linkedIds = JSON.parse(c.linked_evidence || '[]');
            if (linkedIds.includes(id) || linkedIds.includes(String(id))) {
              results.push({ type: 'case', id: c.id, relationship: 'linked', sourceTable: 'cases' });
            }
          } catch { /* skip */ }
        }
        break;
      }
    }
  } catch (err: any) { console.error('[Connections] junction table query error:', err?.message); }

  return results;
}

// ── BFS Graph Builder ────────────────────────────────────────

const MAX_NODES = 200;

function buildGraph(db: any, seedType: string, seedId: number, maxDepth: number = 2): { nodes: GNode[]; edges: GEdge[] } {
  const nodeMap = new Map<string, GNode>();
  const edgeSet = new Set<string>();
  const edges: GEdge[] = [];
  const queue: Array<{ type: string; id: number; depth: number }> = [];

  function nodeKey(type: string, id: number): string {
    return `${type}-${id}`;
  }

  function addNode(type: string, id: number, depth: number): boolean {
    if (nodeMap.size >= MAX_NODES) return false;
    const key = nodeKey(type, id);
    if (nodeMap.has(key)) return false;
    nodeMap.set(key, {
      id: key,
      type,
      entityId: id,
      label: getRecordLabel(db, type, id),
      metadata: getNodeMetadata(db, type, id),
      depth,
    });
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

  // Seed
  addNode(seedType, seedId, 0);
  queue.push({ type: seedType, id: seedId, depth: 0 });

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    if (nodeMap.size >= MAX_NODES) break;

    const nextDepth = current.depth + 1;
    const connections = findConnections(db, current.type, current.id);

    for (const conn of connections) {
      if (nodeMap.size >= MAX_NODES) break;
      const isNew = addNode(conn.type, conn.id, nextDepth);
      addEdge(current.type, current.id, conn.type, conn.id, conn.relationship, conn.sourceTable);
      if (isNew && nextDepth < maxDepth) {
        queue.push({ type: conn.type, id: conn.id, depth: nextDepth });
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges };
}

// ── Routes ───────────────────────────────────────────────────

const VALID_TYPES = ['person', 'vehicle', 'property', 'evidence', 'case', 'incident'];

// GET /connections/graph?type=person&id=123&depth=2
router.get('/graph', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { type, id, depth } = req.query;

    if (!type || !id) {
      return res.status(400).json({ error: 'type and id query parameters are required', code: 'TYPE_AND_ID_QUERY' });
    }
    if (!VALID_TYPES.includes(String(type))) {
      return res.status(400).json({ error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }

    if (isNaN(Number(id)) || Number(id) < 1) {
      return res.status(400).json({ error: 'id must be a positive integer', code: 'ID_MUST_BE_A' });
    }

    const maxDepth = Math.min(Math.max(Number(depth) || 2, 1), 3);
    const graph = buildGraph(db, String(type), Number(id), maxDepth);

    auditLog(req, 'SEARCH', 'record_link', Number(id), `Connection graph: ${type} #${id} (depth ${maxDepth}, ${graph.nodes.length} nodes)`);

    res.json(graph);
  } catch (error: any) {
    console.error('Connection graph error:', error?.message || 'Unknown error');
<<<<<<< HEAD
    res.status(500).json({ error: 'Failed to build connection graph' });
=======
    res.status(500).json({ error: 'Failed to build connection graph', code: 'FAILED_TO_BUILD_CONNECTION' });
>>>>>>> origin/main
  }
});

// GET /connections/search?q=term — cross-entity search
router.get('/search', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { q } = req.query;

    if (!q || String(q).trim().length < 2) {
      return res.json([]);
    }

    const term = `%${escapeLike(String(q).trim())}%`;
    const results: Array<{ id: number; type: string; label: string }> = [];

    // Persons
    try {
      const persons = db.prepare(`
        SELECT id, first_name, last_name FROM persons
        WHERE first_name LIKE ? ESCAPE '\\' OR last_name LIKE ? ESCAPE '\\' OR (first_name || ' ' || last_name) LIKE ? ESCAPE '\\'
        LIMIT 8
      `).all(term, term, term) as any[];
      results.push(...persons.map((p: any) => ({ id: p.id, type: 'person', label: `${p.first_name} ${p.last_name}` })));
    } catch (err: any) { console.error('[Connections] persons search error:', err?.message); }

    // Vehicles
    try {
      const vehicles = db.prepare(`
        SELECT id, make, model, plate_number, color FROM vehicles_records
        WHERE make LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\' OR plate_number LIKE ? ESCAPE '\\' OR vin LIKE ? ESCAPE '\\'
        LIMIT 8
      `).all(term, term, term, term) as any[];
      results.push(...vehicles.map((v: any) => ({ id: v.id, type: 'vehicle', label: `${v.color || ''} ${v.make || ''} ${v.model || ''} ${v.plate_number ? `(${v.plate_number})` : ''}`.trim() })));
    } catch (err: any) { console.error('[Connections] vehicles search error:', err?.message); }

    // Properties
    try {
      const properties = db.prepare(`
        SELECT id, name, address FROM properties
        WHERE name LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\'
        LIMIT 8
      `).all(term, term) as any[];
      results.push(...properties.map((p: any) => ({ id: p.id, type: 'property', label: p.name })));
    } catch (err: any) { console.error('[Connections] properties search error:', err?.message); }

    // Cases
    try {
      const cases = db.prepare(`
        SELECT id, case_number, title FROM cases
        WHERE case_number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
        LIMIT 8
      `).all(term, term) as any[];
      results.push(...cases.map((c: any) => ({ id: c.id, type: 'case', label: `${c.case_number} - ${c.title}` })));
    } catch (err: any) { console.error('[Connections] cases search error:', err?.message); }

    // Incidents
    try {
      const incidents = db.prepare(`
        SELECT id, incident_number, incident_type FROM incidents
        WHERE incident_number LIKE ? ESCAPE '\\' OR incident_type LIKE ? ESCAPE '\\' OR location_address LIKE ? ESCAPE '\\'
        LIMIT 8
      `).all(term, term, term) as any[];
      results.push(...incidents.map((i: any) => ({ id: i.id, type: 'incident', label: `${i.incident_number || ''} ${i.incident_type}`.trim() })));
    } catch (err: any) { console.error('[Connections] incidents search error:', err?.message); }

    // Evidence
    try {
      const evidence = db.prepare(`
        SELECT id, evidence_number, description FROM evidence
        WHERE evidence_number LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
        LIMIT 8
      `).all(term, term) as any[];
      results.push(...evidence.map((e: any) => ({ id: e.id, type: 'evidence', label: `${e.evidence_number || ''} ${e.description || ''}`.trim() })));
    } catch (err: any) { console.error('[Connections] evidence search error:', err?.message); }

    res.json(results);
  } catch (error: any) {
    console.error('Connection search error:', error?.message || 'Unknown error');
<<<<<<< HEAD
    res.status(500).json({ error: 'Search failed' });
=======
    res.status(500).json({ error: 'Search failed', code: 'SEARCH_FAILED' });
  }
});

// ─── CSV EXPORT ──────────────────────────────────────────

// GET /connections/export/csv — Export record_links
router.get('/export/csv', requireRole('admin', 'manager', 'supervisor'), (req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, source_type, source_id, target_type, target_id, relationship, created_at
      FROM record_links
      ORDER BY created_at DESC LIMIT 10000
    `).all();
    sendCsv(res, 'connections_export.csv', [
      { key: 'id', header: 'ID' },
      { key: 'source_type', header: 'Source Type' },
      { key: 'source_id', header: 'Source ID' },
      { key: 'target_type', header: 'Target Type' },
      { key: 'target_id', header: 'Target ID' },
      { key: 'relationship', header: 'Relationship' },
      { key: 'created_at', header: 'Created At' },
    ], rows);
  } catch (error: any) {
    console.error('[Connections] CSV export error:', error?.message || 'Unknown error');
    res.status(500).json({ error: 'Export failed', code: 'EXPORT_FAILED' });
>>>>>>> origin/main
  }
});

export default router;
