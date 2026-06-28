// ============================================================
// RMPG Flex — Service location notation system
// ============================================================
// Operator-authored constraints on how/when a specific address,
// business, or person can be served. Matched at intake time
// and used by: the attempt scheduler, the PSO briefing note,
// the CFS description, and the dashboard calendar.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query, queryFirst, execute } from './db';
import { normAddr } from './serveIntakeRecords';

export interface ServiceLocationNote {
  id: number;
  entity_type: string;
  entity_name: string | null;
  entity_id: number | null;
  address_norm: string | null;
  note_text: string;
  note_type: string;
  days_available: number[] | null;  // [0-6], 0=Sun; null = any day
  hours_start: string | null;        // HH:MM
  hours_end: string | null;          // HH:MM
  cutoff_time: string | null;        // HH:MM — stops accepting service
  created_by: number | null;
  created_at: string;
  updated_at: string;
  active: number;
}

interface RawNote {
  id: number; entity_type: string; entity_name: string | null;
  entity_id: number | null; address_norm: string | null; note_text: string;
  note_type: string; days_available: string | null; hours_start: string | null;
  hours_end: string | null; cutoff_time: string | null;
  created_by: number | null; created_at: string; updated_at: string; active: number;
}

function parseNote(raw: RawNote): ServiceLocationNote {
  let days: number[] | null = null;
  try { if (raw.days_available) days = JSON.parse(raw.days_available); } catch { /* */ }
  return { ...raw, days_available: days };
}

// ── Table guard ───────────────────────────────────────────────
async function tableExists(db: D1Database): Promise<boolean> {
  const r = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='serve_location_notes'`,
  );
  return !!r?.n;
}

// ── Lookup — called at intake commit time ─────────────────────
// Returns the best matching note (most recently updated active row)
// for the given business name, person name, and/or address.
// Precedence: entity_id match > entity_name match > address match.
export async function findLocationNote(
  db: D1Database,
  params: {
    businessName?: string | null;
    personName?: string | null;
    address?: string | null;
  },
): Promise<ServiceLocationNote | null> {
  if (!(await tableExists(db))) return null;

  const addrNorm = normAddr(params.address);
  const bizLower = (params.businessName || '').toLowerCase().trim();
  const personLower = (params.personName || '').toLowerCase().trim();

  // Build OR-clauses in priority order; pick most recent active match.
  const conditions: string[] = ['active = 1'];
  const args: (string | number)[] = [];

  const clauses: string[] = [];
  if (bizLower) {
    clauses.push('LOWER(entity_name) = ?');
    args.push(bizLower);
  }
  if (personLower && !bizLower) {
    clauses.push('LOWER(entity_name) = ?');
    args.push(personLower);
  }
  if (addrNorm) {
    clauses.push('address_norm = ?');
    args.push(addrNorm);
  }
  if (!clauses.length) return null;

  conditions.push(`(${clauses.join(' OR ')})`);

  const rows = await query<RawNote>(
    db,
    `SELECT * FROM serve_location_notes
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE WHEN ${bizLower ? 'LOWER(entity_name) = ?' : '0'} THEN 0
            WHEN ${addrNorm ? 'address_norm = ?' : '0'} THEN 1
            ELSE 2 END,
       updated_at DESC
     LIMIT 5`,
    ...(bizLower ? [bizLower] : []),
    ...(addrNorm ? [addrNorm] : []),
    ...args,
  );

  return rows.length ? parseNote(rows[0]) : null;
}

// ── List — for the management UI ──────────────────────────────
export async function listLocationNotes(
  db: D1Database,
  params: { active_only?: boolean; limit?: number; search?: string } = {},
): Promise<ServiceLocationNote[]> {
  if (!(await tableExists(db))) return [];

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (params.active_only !== false) { where.push('active = 1'); }
  if (params.search) {
    where.push('(LOWER(entity_name) LIKE ? OR LOWER(note_text) LIKE ? OR address_norm LIKE ?)');
    const s = `%${params.search.toLowerCase()}%`;
    args.push(s, s, s);
  }
  const rows = await query<RawNote>(
    db,
    `SELECT * FROM serve_location_notes
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY updated_at DESC
     LIMIT ?`,
    ...args, params.limit ?? 200,
  );
  return rows.map(parseNote);
}

// ── Create ────────────────────────────────────────────────────
export interface CreateNoteInput {
  entity_type: string;
  entity_name?: string | null;
  entity_id?: number | null;
  address?: string | null;
  note_text: string;
  note_type?: string;
  days_available?: number[] | null;
  hours_start?: string | null;
  hours_end?: string | null;
  cutoff_time?: string | null;
  created_by?: number | null;
}

export async function createLocationNote(
  db: D1Database,
  input: CreateNoteInput,
): Promise<number> {
  const result = await execute(
    db,
    `INSERT INTO serve_location_notes
       (entity_type, entity_name, entity_id, address_norm, note_text, note_type,
        days_available, hours_start, hours_end, cutoff_time, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.entity_type,
    input.entity_name?.trim() || null,
    input.entity_id ?? null,
    normAddr(input.address),
    input.note_text.trim(),
    input.note_type || 'hours',
    input.days_available != null ? JSON.stringify(input.days_available) : null,
    input.hours_start || null,
    input.hours_end || null,
    input.cutoff_time || null,
    input.created_by ?? null,
  );
  return Number(result.meta.last_row_id);
}

// ── Update ────────────────────────────────────────────────────
export async function updateLocationNote(
  db: D1Database,
  id: number,
  input: Partial<CreateNoteInput>,
): Promise<void> {
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const args: (string | number | null)[] = [];

  if (input.entity_type !== undefined) { sets.push('entity_type = ?'); args.push(input.entity_type); }
  if (input.entity_name !== undefined) { sets.push('entity_name = ?'); args.push(input.entity_name?.trim() || null); }
  if (input.entity_id !== undefined) { sets.push('entity_id = ?'); args.push(input.entity_id ?? null); }
  if (input.address !== undefined) { sets.push('address_norm = ?'); args.push(normAddr(input.address)); }
  if (input.note_text !== undefined) { sets.push('note_text = ?'); args.push(input.note_text.trim()); }
  if (input.note_type !== undefined) { sets.push('note_type = ?'); args.push(input.note_type); }
  if (input.days_available !== undefined) {
    sets.push('days_available = ?');
    args.push(input.days_available != null ? JSON.stringify(input.days_available) : null);
  }
  if (input.hours_start !== undefined) { sets.push('hours_start = ?'); args.push(input.hours_start || null); }
  if (input.hours_end !== undefined) { sets.push('hours_end = ?'); args.push(input.hours_end || null); }
  if (input.cutoff_time !== undefined) { sets.push('cutoff_time = ?'); args.push(input.cutoff_time || null); }

  if (sets.length === 1) return;
  args.push(id);
  await execute(db, `UPDATE serve_location_notes SET ${sets.join(', ')} WHERE id = ?`, ...args);
}

// ── Deactivate ────────────────────────────────────────────────
export async function deactivateLocationNote(db: D1Database, id: number): Promise<void> {
  await execute(db, `UPDATE serve_location_notes SET active = 0, updated_at = datetime('now') WHERE id = ?`, id);
}

// ── Human-readable constraint summary (for briefing/CFS) ──────
export function noteConstraintSummary(note: ServiceLocationNote): string {
  const parts: string[] = [];
  if (note.days_available && note.days_available.length < 7) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = note.days_available.map((d) => DAYS[d] ?? d).join('/');
    parts.push(dayNames);
  }
  if (note.hours_start && note.hours_end) {
    parts.push(`${note.hours_start}–${note.hours_end}`);
  } else if (note.hours_start) {
    parts.push(`from ${note.hours_start}`);
  }
  if (note.cutoff_time) {
    parts.push(`cutoff ${note.cutoff_time}`);
  }
  return parts.join(', ') || note.note_type;
}
