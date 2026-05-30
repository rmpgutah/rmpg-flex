// ============================================================
// RMPG Flex — AI Dispatcher Awareness + CAD Lookups
// ============================================================
// The "advanced awareness" layer: gives the AI dispatcher real-time
// situational grounding from live D1 and the ability to actually run the
// record checks a unit asks for (plate / person / warrant) instead of
// faking "stand by".
//
//   gatherAwareness(db, …)  → a compact text snapshot of the board that
//                             is injected into EVERY reasoning turn.
//   runLookup(db, …)        → executes a real CAD query and returns a
//                             terse facts string the model reads back.
//
// Every query is wrapped so a missing/empty table degrades to silence,
// never an exception — this all runs in the relay's waitUntil tail and
// must never throw into it. All SELECTs name explicit columns (never
// SELECT * on calls_for_service, which is at the 100-column D1 cap).
//
// Column names were verified against the LIVE schema (785de7ae) on
// 2026-05-29, not /migrations/ — see [[feedback-verify-live-schema-before-insert]].
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst } from './db';

// Statuses that mean a call is no longer on the active board.
const CLOSED_CALL_STATUSES = ['closed', 'cleared', 'archived', 'cancelled', 'canceled'];
// Statuses that mean a unit is not currently working.
const OFF_DUTY_UNIT_STATUSES = ['off_duty', 'offline', 'out_of_service', 'oos', 'unavailable'];

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch (err) {
    console.warn('[awareness] query failed (skipped):', (err as Error)?.message);
    return [];
  }
}

interface UnitRow { call_sign: string; status: string | null; assigned_beat: string | null; current_call_id: number | null }
interface CallRow {
  call_number: string | null; incident_type: string | null; status: string | null;
  location_address: string | null; unit_call_signs: string | null;
}

/**
 * Build a compact, radio-relevant snapshot of the current board for the
 * model. Kept short on purpose — every line is tokens on every reply.
 */
export async function gatherAwareness(db: D1Database, channelId: number, speaker: string | null): Promise<string> {
  const lines: string[] = [];

  // ── The transmitting unit + its current assignment ──
  if (speaker) {
    const unit = await queryFirst<UnitRow>(
      db,
      'SELECT call_sign, status, assigned_beat, current_call_id FROM units WHERE call_sign = ? LIMIT 1',
      speaker,
    ).catch(() => null);
    if (unit) {
      lines.push(`Transmitting unit ${unit.call_sign}: ${unit.status || 'status unknown'}${unit.assigned_beat ? `, beat ${unit.assigned_beat}` : ''}.`);
      if (unit.current_call_id) {
        const c = await queryFirst<CallRow>(
          db,
          'SELECT call_number, incident_type, status, location_address, unit_call_signs FROM calls_for_service WHERE id = ?',
          unit.current_call_id,
        ).catch(() => null);
        if (c) lines.push(`  Currently assigned to ${c.call_number || 'a call'} — ${c.incident_type || 'unknown type'} at ${c.location_address || 'unknown location'} [${c.status || '?'}].`);
      }
    }
  }

  // ── Active calls on the board ──
  const calls = await safe(query<CallRow>(
    db,
    `SELECT call_number, incident_type, status, location_address, unit_call_signs
     FROM calls_for_service
     WHERE COALESCE(status,'') NOT IN (${CLOSED_CALL_STATUSES.map(() => '?').join(',')}) AND archived_at IS NULL
     ORDER BY COALESCE(priority_score, 0) DESC, datetime(created_at) DESC
     LIMIT 6`,
    ...CLOSED_CALL_STATUSES,
  ));
  if (calls.length) {
    lines.push('Active calls:');
    for (const c of calls) {
      lines.push(`  ${c.call_number || '(no #)'} ${c.incident_type || '?'} @ ${c.location_address || '?'} [${c.status || '?'}${c.unit_call_signs ? `, units ${c.unit_call_signs}` : ''}]`);
    }
  }

  // ── Units currently working ──
  const units = await safe(query<UnitRow>(
    db,
    `SELECT call_sign, status, assigned_beat FROM units
     WHERE call_sign IS NOT NULL AND COALESCE(status,'') NOT IN (${OFF_DUTY_UNIT_STATUSES.map(() => '?').join(',')})
     ORDER BY call_sign LIMIT 12`,
    ...OFF_DUTY_UNIT_STATUSES,
  ));
  if (units.length) {
    lines.push('Units on duty: ' + units.map((u) => `${u.call_sign}(${u.status || '?'}${u.assigned_beat ? `,beat ${u.assigned_beat}` : ''})`).join(', '));
  }

  // ── Active BOLOs ──
  const bolos = await safe(query<{ bolo_number: string | null; type: string | null; title: string | null; priority: number | null }>(
    db,
    `SELECT bolo_number, type, title, priority FROM bolos
     WHERE COALESCE(status,'') NOT IN ('expired','closed','cancelled','canceled')
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
     ORDER BY COALESCE(priority,0) DESC, datetime(created_at) DESC LIMIT 5`,
  ));
  if (bolos.length) {
    lines.push('Active BOLOs: ' + bolos.map((b) => `${b.bolo_number || b.type || 'BOLO'}${b.title ? ` (${b.title})` : ''}`).join('; '));
  }

  // ── Active panic alerts (highest urgency) ──
  const panics = await safe(query<{ id: number; location_address: string | null }>(
    db,
    `SELECT id, location_address FROM panic_alerts WHERE COALESCE(status,'') = 'active' LIMIT 3`,
  ));
  if (panics.length) {
    lines.push(`** ACTIVE PANIC ALERT(S): ${panics.length} — officer in distress${panics[0].location_address ? ` near ${panics[0].location_address}` : ''}. Treat as top priority. **`);
  }

  return lines.length ? lines.join('\n') : 'No active CAD activity on the board.';
}

// ─── CAD lookups ────────────────────────────────────────────

export type LookupType = 'plate' | 'person' | 'warrant';
export interface LookupRequest { type: LookupType; query: string }

const norm = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();

/**
 * Run the record check a unit requested. Returns a terse facts string for
 * the model to read back over the radio, or a clear "no record" line.
 * Returns null only on a hard failure (so the caller can fall back).
 */
export async function runLookup(db: D1Database, req: LookupRequest): Promise<string | null> {
  try {
    if (req.type === 'plate') return await lookupPlate(db, req.query);
    if (req.type === 'person') return await lookupPerson(db, req.query);
    if (req.type === 'warrant') return await lookupWarrant(db, req.query);
    return null;
  } catch (err) {
    console.error('[awareness] lookup failed:', (err as Error)?.message);
    return null;
  }
}

async function lookupPlate(db: D1Database, raw: string): Promise<string> {
  const plate = norm(raw).replace(/\s+/g, '');
  const v = await queryFirst<{
    plate_number: string; registration_state: string | null; state: string | null;
    make: string | null; model: string | null; year: number | null; color: string | null;
    is_stolen: number | null; stolen_status: string | null; owner_name: string | null;
    registered_owner: string | null; insurance_status: string | null; flags: string | null;
  }>(
    db,
    `SELECT plate_number, registration_state, state, make, model, year, color,
            is_stolen, stolen_status, owner_name, registered_owner, insurance_status, flags
     FROM vehicles_records
     WHERE REPLACE(REPLACE(UPPER(plate_number),' ',''),'-','') = ?
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`,
    plate,
  );
  if (!v) return `No record on file for plate ${norm(raw)}.`;
  const desc = [v.year, v.color, v.make, v.model].filter(Boolean).join(' ') || 'vehicle';
  const owner = v.registered_owner || v.owner_name;
  const stolen = v.is_stolen || (v.stolen_status && /stolen|yes|active/i.test(v.stolen_status));
  const parts = [
    `Plate ${v.plate_number}${v.registration_state || v.state ? ` (${v.registration_state || v.state})` : ''}: ${desc}.`,
    owner ? `Registered owner ${owner}.` : null,
    stolen ? 'FLAGGED STOLEN — confirm and use caution.' : 'Not flagged stolen.',
    v.insurance_status ? `Insurance ${v.insurance_status}.` : null,
    v.flags ? `Flags: ${v.flags}.` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

async function lookupPerson(db: D1Database, raw: string): Promise<string> {
  const q = `%${raw.trim().replace(/\s+/g, '%')}%`;
  const p = await queryFirst<{
    id: number; first_name: string | null; last_name: string | null; dob: string | null;
    flags: string | null; caution_flags: string | null; is_sex_offender: number | null;
    gang_affiliation: string | null;
  }>(
    db,
    `SELECT id, first_name, last_name, dob, flags, caution_flags, is_sex_offender, gang_affiliation
     FROM persons
     WHERE (TRIM(first_name || ' ' || last_name) LIKE ? OR last_name LIKE ? OR first_name LIKE ?)
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 1`,
    q, q, q,
  );
  if (!p) return `No person record matching "${raw.trim()}".`;
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || raw.trim();
  // Outstanding warrants for this person (by id or by name).
  const warrants = await query<{ warrant_number: string | null; offense: string | null; status: string | null }>(
    db,
    `SELECT warrant_number, COALESCE(offense, offense_description, charge_description, description) AS offense, status
     FROM warrants
     WHERE (person_id = ? OR subject_person_id = ? OR TRIM(COALESCE(subject_first_name,'') || ' ' || COALESCE(subject_last_name,'')) LIKE ? OR subject_name LIKE ?)
       AND archived_at IS NULL AND COALESCE(status,'') NOT IN ('served','cleared','recalled','closed','quashed')
     LIMIT 3`,
    p.id, p.id, `%${name}%`, `%${name}%`,
  ).catch(() => []);
  const cautions = [p.caution_flags, p.flags].filter(Boolean).join('; ');
  const parts = [
    `${name}${p.dob ? `, DOB ${p.dob}` : ''}.`,
    warrants.length
      ? `ACTIVE WARRANT${warrants.length > 1 ? 'S' : ''}: ${warrants.map((w) => `${w.warrant_number || 'warrant'}${w.offense ? ` for ${w.offense}` : ''}`).join('; ')}. Confirm before action.`
      : 'No active warrants on file.',
    p.is_sex_offender ? 'Registered sex offender.' : null,
    p.gang_affiliation ? `Gang affiliation noted: ${p.gang_affiliation}.` : null,
    cautions ? `Caution: ${cautions}.` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

async function lookupWarrant(db: D1Database, raw: string): Promise<string> {
  const q = `%${raw.trim().replace(/\s+/g, '%')}%`;
  const rows = await query<{
    warrant_number: string | null; subject_name: string | null; subject_first_name: string | null;
    subject_last_name: string | null; offense: string | null; bond_amount: string | null;
    status: string | null; issuing_agency: string | null;
  }>(
    db,
    `SELECT warrant_number, subject_name, subject_first_name, subject_last_name,
            COALESCE(offense, offense_description, charge_description, description) AS offense,
            COALESCE(bond_amount, bail_amount) AS bond_amount, status, issuing_agency
     FROM warrants
     WHERE (subject_name LIKE ? OR TRIM(COALESCE(subject_first_name,'') || ' ' || COALESCE(subject_last_name,'')) LIKE ? OR warrant_number LIKE ?)
       AND archived_at IS NULL
     ORDER BY datetime(COALESCE(updated_at, created_at)) DESC LIMIT 3`,
    q, q, q,
  );
  if (!rows.length) return `No warrant on file matching "${raw.trim()}".`;
  return rows.map((w) => {
    const subj = w.subject_name || [w.subject_first_name, w.subject_last_name].filter(Boolean).join(' ') || 'subject';
    return `${w.warrant_number || 'Warrant'} on ${subj}${w.offense ? ` — ${w.offense}` : ''}${w.bond_amount ? `, bond ${w.bond_amount}` : ''} [${w.status || 'status unknown'}${w.issuing_agency ? `, ${w.issuing_agency}` : ''}].`;
  }).join(' ');
}
