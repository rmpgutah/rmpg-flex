// ============================================================
// RMPG Flex — Intel Search indexer + person resolution pass
// ============================================================
// Rebuilds the intel_index FTS5 table and computes "possible same
// person" suggestions. Called from the Worker scheduled() cron and from
// POST /api/intel/reindex. Every entity type is try/catch-isolated so
// one bad/missing table never breaks the rest (connections.ts pattern).
//
// Full re-sync per type — dataset is ~6 MB, deltas aren't worth the
// complexity. Inserts go through db.batch() in chunks to stay inside
// the Worker subrequest budget.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, execute, executeBatch } from './db';
import { isRealValue, normalizePhone, normalizeAddress, nameSimilarity } from './intelMatch';

interface IndexRow { type: string; id: number; label: string; body: string; identifiers: string }

const joinReal = (...vals: unknown[]) => vals.filter(isRealValue).map(String).join(' ');

export const INTEL_TYPES = ['person', 'vehicle', 'property', 'case', 'incident', 'call',
  'warrant', 'citation', 'field_interview', 'trespass_order', 'evidence'] as const;

async function rowsFor(db: D1Database, type: string): Promise<IndexRow[]> {
  switch (type) {
    case 'person':
      return (await query<any>(db, 'SELECT id, first_name, last_name, dob, address, city, phone, flags FROM persons')).map((p) => ({
        type, id: p.id,
        label: joinReal(p.first_name, p.last_name) || `Person #${p.id}`,
        body: joinReal(p.address, p.city, p.flags),
        identifiers: joinReal(p.dob, isRealValue(p.phone) ? normalizePhone(String(p.phone)) : null),
      }));
    case 'vehicle':
      return (await query<any>(db, 'SELECT id, plate_number, vin, make, model, year, color FROM vehicles_records')).map((v) => ({
        type, id: v.id,
        label: joinReal(v.color, v.year, v.make, v.model) || `Vehicle #${v.id}`,
        body: '',
        identifiers: joinReal(v.plate_number, v.vin),
      }));
    case 'property':
      return (await query<any>(db, 'SELECT id, name, address, property_type FROM properties')).map((p) => ({
        type, id: p.id, label: joinReal(p.name) || `Property #${p.id}`,
        body: joinReal(p.address, p.property_type), identifiers: '',
      }));
    case 'case':
      return (await query<any>(db, 'SELECT id, case_number, title, case_type, status FROM cases')).map((r) => ({
        type, id: r.id, label: joinReal(r.case_number, r.title) || `Case #${r.id}`,
        body: joinReal(r.case_type, r.status), identifiers: joinReal(r.case_number),
      }));
    case 'incident':
      return (await query<any>(db, 'SELECT id, incident_number, incident_type, status, location_address FROM incidents')).map((r) => ({
        type, id: r.id, label: joinReal(r.incident_number, r.incident_type) || `Incident #${r.id}`,
        body: joinReal(r.status, r.location_address), identifiers: joinReal(r.incident_number),
      }));
    case 'call':
      return (await query<any>(db, 'SELECT id, call_number, incident_type, status, location_address FROM calls_for_service')).map((r) => ({
        type, id: r.id, label: joinReal(r.call_number, r.incident_type) || `CFS-${r.id}`,
        body: joinReal(r.status, r.location_address), identifiers: joinReal(r.call_number),
      }));
    case 'warrant':
      return (await query<any>(db, 'SELECT id, warrant_number, status, type, charge_description FROM warrants')).map((r) => ({
        type, id: r.id, label: joinReal(r.warrant_number) || `Warrant #${r.id}`,
        body: joinReal(r.status, r.type, r.charge_description), identifiers: joinReal(r.warrant_number),
      }));
    case 'citation':
      return (await query<any>(db, 'SELECT id, citation_number, type, status, violation_description FROM citations')).map((r) => ({
        type, id: r.id, label: joinReal(r.citation_number) || `Citation #${r.id}`,
        body: joinReal(r.type, r.status, r.violation_description), identifiers: joinReal(r.citation_number),
      }));
    case 'field_interview':
      return (await query<any>(db, 'SELECT id, fi_number, location, contact_reason FROM field_interviews')).map((r) => ({
        type, id: r.id, label: joinReal(r.fi_number) || `FI #${r.id}`,
        body: joinReal(r.location, r.contact_reason), identifiers: joinReal(r.fi_number),
      }));
    case 'trespass_order':
      return (await query<any>(db, 'SELECT id, order_number, location, status FROM trespass_orders')).map((r) => ({
        type, id: r.id, label: joinReal(r.order_number) || `Trespass #${r.id}`,
        body: joinReal(r.location, r.status), identifiers: joinReal(r.order_number),
      }));
    case 'evidence':
      return (await query<any>(db, 'SELECT id, evidence_number, description, evidence_type, status FROM evidence')).map((r) => ({
        type, id: r.id, label: joinReal(r.evidence_number) || `Evidence #${r.id}`,
        body: joinReal(r.description, r.evidence_type, r.status), identifiers: joinReal(r.evidence_number),
      }));
    default: return [];
  }
}

export async function rebuildIntelIndex(db: D1Database): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const type of INTEL_TYPES) {
    try {
      const rows = await rowsFor(db, type);
      await execute(db, 'DELETE FROM intel_index WHERE entity_type = ?', type);
      const INSERT = 'INSERT INTO intel_index (entity_type, entity_id, label, body, identifiers) VALUES (?, ?, ?, ?, ?)';
      for (let i = 0; i < rows.length; i += 50) {
        await executeBatch(db, rows.slice(i, i + 50).map((r) => ({
          sql: INSERT, bindings: [r.type, r.id, r.label, r.body, r.identifiers],
        })));
      }
      await execute(db,
        `INSERT INTO intel_index_state (entity_type, last_synced_at, row_count) VALUES (?, datetime('now'), ?)
         ON CONFLICT(entity_type) DO UPDATE SET last_synced_at = datetime('now'), row_count = excluded.row_count`,
        type, rows.length);
      counts[type] = rows.length;
    } catch (err: any) {
      console.error(`[intel-index] ${type} sync failed:`, err?.message);
      counts[type] = -1;
    }
  }
  return counts;
}

// Candidate "possible same person" pairs. Blocking keys (DOB, phone,
// address) keep this O(groups), not O(n^2) over all persons.
export async function computeResolutionSuggestions(db: D1Database): Promise<number> {
  const persons = await query<any>(db, 'SELECT id, first_name, last_name, dob, address, phone FROM persons');
  const pairs = new Map<string, { a: number; b: number; score: number; reasons: { rule: string; detail: string }[] }>();
  const addPair = (a: number, b: number, score: number, rule: string, detail: string) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = `${lo}:${hi}`;
    const e = pairs.get(key) || { a: lo, b: hi, score: 0, reasons: [] };
    e.score = Math.min(1, e.score + score);
    e.reasons.push({ rule, detail });
    pairs.set(key, e);
  };
  const byKey = (keyOf: (p: any) => string | null) => {
    const groups = new Map<string, any[]>();
    for (const p of persons) {
      const k = keyOf(p);
      if (k) groups.set(k, [...(groups.get(k) || []), p]);
    }
    return groups;
  };
  const fullName = (p: any) => joinReal(p.first_name, p.last_name);

  for (const [dob, group] of byKey((p) => (isRealValue(p.dob) ? String(p.dob) : null)))
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const sim = nameSimilarity(fullName(group[i]), fullName(group[j]));
        if (sim >= 0.5) addPair(group[i].id, group[j].id, 0.5 + sim * 0.3, 'dob_name', `same DOB ${dob}, name sim ${sim.toFixed(2)}`);
      }
  for (const [, group] of byKey((p) => (isRealValue(p.phone) ? normalizePhone(String(p.phone)) : null)))
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++)
        addPair(group[i].id, group[j].id, 0.35, 'shared_phone', 'same phone number');
  for (const [, group] of byKey((p) => (isRealValue(p.address) ? normalizeAddress(String(p.address)) : null)))
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const sim = nameSimilarity(fullName(group[i]), fullName(group[j]));
        if (sim >= 0.5) addPair(group[i].id, group[j].id, 0.2, 'shared_address', 'same address + similar name');
      }

  let written = 0;
  for (const { a, b, score, reasons } of pairs.values()) {
    if (score < 0.35) continue;
    // Never downgrade a human decision: only insert, or refresh PENDING rows.
    await execute(db,
      `INSERT INTO entity_resolution_suggestions (person_a, person_b, score, reasons)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(person_a, person_b) DO UPDATE SET
         score = excluded.score, reasons = excluded.reasons
       WHERE entity_resolution_suggestions.status = 'pending'`,
      a, b, score, JSON.stringify(reasons));
    written++;
  }
  return written;
}
