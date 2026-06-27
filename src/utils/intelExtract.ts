// ============================================================
// RMPG Flex — Narrative entity extraction (Wave 1)
// ============================================================
// Mines call/incident free text for entities we can RESOLVE to existing
// records (known persons by name, vehicles by plate, persons by phone) —
// no NER/AI, so every suggestion is a concrete, confirmable link. Writes
// intel_link_suggestions rows for review on /intel; confirming creates
// the real junction row. Pure extractors are unit-tested in
// tests/intelExtract.test.ts.
// ============================================================

import { log } from './logger';
import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { isRealValue, normalizePhone } from './intelMatch';

// ── Pure extractors ──────────────────────────────────────────

// Plate-shaped tokens: 5-8 alphanumerics containing at least one digit
// and one letter (pure numbers are block numbers/case numbers).
export function extractPlateTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(/\b([A-Z0-9]{5,8})\b/g)) {
    const t = m[1];
    if (/\d/.test(t) && /[A-Z]/.test(t)) out.add(t);
  }
  return [...out];
}

// 10/11-digit phone groups (allowing separators), normalized to 10 digits.
export function extractPhoneTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g)) {
    const d = normalizePhone(m[0]);
    if (d.length === 10) out.add(d);
  }
  return [...out];
}

// Known-person mention matching: "First Last" or "Last, First",
// case-insensitive, word-bounded (no partial-name matches).
export function findNameMentions(
  text: string,
  persons: Array<{ id: number; first_name: string; last_name: string }>,
): number[] {
  const hay = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const esc = (s: string) => s.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ids: number[] = [];
  for (const p of persons) {
    if (!isRealValue(p.first_name) || !isRealValue(p.last_name)) continue;
    const f = esc(p.first_name), l = esc(p.last_name);
    const fl = new RegExp(`\\b${f}\\s+${l}\\b`);
    const lf = new RegExp(`\\b${l},\\s*${f}\\b`);
    if (fl.test(hay) || lf.test(hay)) ids.push(p.id);
  }
  return ids;
}

// ── DB-bound extraction run ──────────────────────────────────

interface SourceDoc { source_type: 'call' | 'incident'; source_id: number; text: string }

async function gatherSources(db: D1Database, sinceHours: number): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  try {
    for (const r of await query<any>(db,
      `SELECT id, description, notes, subject_description, vehicle_description FROM calls_for_service
       WHERE COALESCE(updated_at, created_at) > datetime('now', ?) LIMIT 200`, `-${sinceHours} hours`)) {
      const text = [r.description, r.notes, r.subject_description, r.vehicle_description].filter(isRealValue).join(' \n ');
      if (text.trim()) docs.push({ source_type: 'call', source_id: r.id, text });
    }
  } catch (err: any) { log.error('[intel-extract] calls failed', { error: err?.message }); }
  try {
    for (const r of await query<any>(db,
      `SELECT id, narrative FROM incidents
       WHERE COALESCE(updated_at, created_at) > datetime('now', ?) LIMIT 200`, `-${sinceHours} hours`)) {
      if (isRealValue(r.narrative)) docs.push({ source_type: 'incident', source_id: r.id, text: String(r.narrative) });
    }
  } catch (err: any) { log.error('[intel-extract] incidents failed', { error: err?.message }); }
  return docs;
}

async function alreadyLinked(db: D1Database, doc: SourceDoc, entityType: string, entityId: number): Promise<boolean> {
  const table = doc.source_type === 'call'
    ? (entityType === 'person' ? 'call_persons' : 'call_vehicles')
    : (entityType === 'person' ? 'incident_persons' : 'incident_vehicles');
  const fk = doc.source_type === 'call' ? 'call_id' : 'incident_id';
  const col = entityType === 'person' ? 'person_id' : 'vehicle_id';
  try {
    const r = await queryFirst<any>(db, `SELECT 1 AS x FROM ${table} WHERE ${fk} = ? AND ${col} = ? LIMIT 1`, doc.source_id, entityId);
    return !!r;
  } catch { return false; }
}

async function suggest(
  db: D1Database, doc: SourceDoc, entityType: string, entityId: number,
  extracted: string, basis: string,
): Promise<boolean> {
  if (await alreadyLinked(db, doc, entityType, entityId)) return false;
  try {
    const r = await execute(db,
      `INSERT OR IGNORE INTO intel_link_suggestions
         (source_type, source_id, entity_type, entity_id, extracted_text, match_basis)
       VALUES (?, ?, ?, ?, ?, ?)`,
      doc.source_type, doc.source_id, entityType, entityId, extracted.slice(0, 200), basis);
    return !!r.meta?.changes;
  } catch (err: any) {
    log.error('[intel-extract] suggest failed', { error: err?.message });
    return false;
  }
}

export async function runExtraction(db: D1Database, sinceHours = 6): Promise<number> {
  const docs = await gatherSources(db, sinceHours);
  if (!docs.length) return 0;

  // Load reference data once per run — small dataset, avoids per-doc scans.
  let persons: any[] = [];
  let platesByToken = new Map<string, number>();
  let personsByPhone = new Map<string, number>();
  try {
    persons = await query<any>(db, 'SELECT id, first_name, last_name, phone FROM persons LIMIT 5000');
    for (const p of persons)
      if (isRealValue(p.phone)) personsByPhone.set(normalizePhone(String(p.phone)), p.id);
  } catch (err: any) { log.error('[intel-extract] persons load failed', { error: err?.message }); }
  try {
    for (const v of await query<any>(db, 'SELECT id, plate_number FROM vehicles_records LIMIT 5000'))
      if (isRealValue(v.plate_number)) platesByToken.set(String(v.plate_number).toUpperCase().replace(/[\s-]/g, ''), v.id);
  } catch (err: any) { log.error('[intel-extract] vehicles load failed', { error: err?.message }); }

  let created = 0;
  for (const doc of docs) {
    try {
      for (const pid of findNameMentions(doc.text, persons))
        if (await suggest(db, doc, 'person', pid, doc.text.slice(0, 200), 'name')) created++;
      for (const token of extractPlateTokens(doc.text)) {
        const vid = platesByToken.get(token);
        if (vid && await suggest(db, doc, 'vehicle', vid, token, 'plate')) created++;
      }
      for (const phone of extractPhoneTokens(doc.text)) {
        const pid = personsByPhone.get(phone);
        if (pid && await suggest(db, doc, 'person', pid, phone, 'phone')) created++;
      }
    } catch (err: any) {
      log.error('[intel-extract] doc failed', { source_type: doc.source_type, source_id: doc.source_id, error: err?.message });
    }
  }
  return created;
}
