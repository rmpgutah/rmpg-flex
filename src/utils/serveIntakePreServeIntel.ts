// ============================================================
// RMPG Flex — Pre-Serve Intelligence Module
// ============================================================
// Cross-references the extracted recipient against existing records
// at intake time. Each check returns { status, detail }.
// ============================================================

import { log } from './logger';
import type { Bindings } from '../types';
import { query, queryFirst } from './db';

export interface IntelCheck {
  status: 'clear' | 'hit' | 'unknown';
  detail: string;
}

export interface PreServeIntel {
  cad_incidents: IntelCheck;
  bolo: IntelCheck;
  prior_serves: IntelCheck;
  property_hazards: IntelCheck;
}

// CAD incident cross-ref: has this address appeared in recent calls?
export async function checkCadIncidents(
  db: D1Database,
  address: string,
): Promise<IntelCheck> {
  if (!address || address.trim().length < 5) {
    return { status: 'unknown', detail: 'No address provided for CAD cross-ref.' };
  }
  try {
    const rows = await query<{ id: number; incident_number: string; type: string; created_at: string }>(
      db,
      `SELECT id, incident_number, type, created_at FROM calls_for_service
       WHERE LOWER(address) LIKE LOWER(?) AND created_at > datetime('now', '-90 days')
       ORDER BY created_at DESC LIMIT 5`,
      `%${address.trim()}%`,
    );
    if (rows.length === 0) {
      return { status: 'clear', detail: 'No recent CAD incidents at this address.' };
    }
    const summary = rows.map(r => `${r.incident_number} (${r.type}, ${r.created_at})`).join('; ');
    return { status: 'hit', detail: `${rows.length} recent CAD incident(s) at this address: ${summary}` };
  } catch (err: any) {
    log.warn('[pre-serve-intel] CAD check failed', { error: err?.message });
    return { status: 'unknown', detail: 'CAD check failed — proceed with caution.' };
  }
}

// BOLO check: is the recipient name on an active BOLO?
export async function checkBolo(
  db: D1Database,
  name: string,
): Promise<IntelCheck> {
  if (!name || name.trim().length < 3) {
    return { status: 'unknown', detail: 'No name provided for BOLO check.' };
  }
  try {
    const lastName = name.trim().split(' ').pop() ?? '';
    const rows = await query<{ id: number; subject_name: string; reason: string; created_at: string }>(
      db,
      `SELECT id, subject_name, reason, created_at FROM comms_bolos
       WHERE active = 1 AND LOWER(subject_name) LIKE LOWER(?)
       ORDER BY created_at DESC LIMIT 5`,
      `%${lastName}%`,
    );
    if (rows.length === 0) {
      return { status: 'clear', detail: 'No active BOLO for this individual.' };
    }
    const summary = rows.map(r => `${r.subject_name} — ${r.reason}`).join('; ');
    return { status: 'hit', detail: `${rows.length} active BOLO(s): ${summary}` };
  } catch (err: any) {
    log.warn('[pre-serve-intel] BOLO check failed', { error: err?.message });
    return { status: 'unknown', detail: 'BOLO check failed — proceed with caution.' };
  }
}

// Prior serves: has this person been served before?
export async function checkPriorServes(
  db: D1Database,
  personId: number | null,
  name: string,
): Promise<IntelCheck> {
  try {
    if (personId) {
      const row = await queryFirst<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM serve_queue WHERE recipient_person_id = ? AND status IN ('served','completed')`,
        personId,
      );
      const count = row?.count ?? 0;
      if (count > 0) {
        return { status: 'hit', detail: `${count} prior serve(s) on record for this person.` };
      }
      return { status: 'clear', detail: 'No prior serves on record.' };
    }
    if (name && name.trim().length > 3) {
      const row = await queryFirst<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM serve_queue
         WHERE LOWER(recipient_name) LIKE LOWER(?) AND status IN ('served','completed')`,
        `%${name.trim()}%`,
      );
      const count = row?.count ?? 0;
      if (count > 0) {
        return { status: 'hit', detail: `${count} prior serve(s) matching this name.` };
      }
      return { status: 'clear', detail: 'No prior serves matching this name.' };
    }
    return { status: 'unknown', detail: 'Insufficient information for prior serve check.' };
  } catch (err: any) {
    log.warn('[pre-serve-intel] prior serve check failed', { error: err?.message });
    return { status: 'unknown', detail: 'Prior serve check failed — proceed with caution.' };
  }
}

// Property hazards: known gated community, access notes, hazard flags
export async function checkPropertyHazards(
  db: D1Database,
  address: string,
): Promise<IntelCheck> {
  if (!address || address.trim().length < 5) {
    return { status: 'unknown', detail: 'No address provided for property check.' };
  }
  try {
    const row = await queryFirst<{
      id: number; name: string; gate_code: string | null; alarm_code: string | null;
      hazard_notes: string | null; access_instructions: string | null; post_orders: string | null;
    }>(
      db,
      `SELECT id, name, gate_code, alarm_code, hazard_notes, access_instructions, post_orders
       FROM properties WHERE LOWER(address) LIKE LOWER(?) LIMIT 1`,
      `%${address.trim()}%`,
    );
    if (!row) {
      return { status: 'clear', detail: 'No property record on file for this address.' };
    }
    const notes: string[] = [];
    if (row.gate_code) notes.push(`Gate code: ${row.gate_code}`);
    if (row.alarm_code) notes.push(`Alarm code: ${row.alarm_code}`);
    if (row.hazard_notes) notes.push(`⚠ HAZARD: ${row.hazard_notes}`);
    if (row.access_instructions) notes.push(`Access: ${row.access_instructions}`);
    if (row.post_orders && !row.post_orders.startsWith('Auto-created')) notes.push(`Post orders: ${row.post_orders}`);
    if (notes.length === 0) {
      return { status: 'clear', detail: `Property record #${row.id} on file — no hazard flags.` };
    }
    return { status: 'hit', detail: notes.join(' | ') };
  } catch (err: any) {
    log.warn('[pre-serve-intel] property check failed', { error: err?.message });
    return { status: 'unknown', detail: 'Property check failed — proceed with caution.' };
  }
}

// Run all pre-serve intel checks
export async function runPreServeIntel(
  env: Bindings,
  address: string,
  recipientName: string,
  personId: number | null,
): Promise<PreServeIntel> {
  const db = env.DB;
  const [cad, bolo, prior, property] = await Promise.all([
    checkCadIncidents(db, address),
    checkBolo(db, recipientName),
    checkPriorServes(db, personId, recipientName),
    checkPropertyHazards(db, address),
  ]);
  return {
    cad_incidents: cad,
    bolo,
    prior_serves: prior,
    property_hazards: property,
  };
}
