// src/utils/stackSync.ts
import { v4 as uuidv4 } from 'uuid';
import { query, queryFirst, execute } from './db';
import { log } from './logger';
import { ACTIVE_CALL_WHERE } from './callStatus';

export interface SyncFields {
  units?: {
    addIds?: number[];
    addCallSigns?: string[];
    removeIds?: number[];
    removeCallSigns?: string[];
  };
  timestamps?: Partial<{
    dispatched_at: string;
    enroute_at: string;
    onscene_at: string;
  }>;
  mileage?: Partial<{
    starting_mileage: number;
    ending_mileage: number;
  }>;
}

/**
 * Assigns a stack_group_id to a newly created call if an active sibling exists
 * at the same address. Call after the ext INSERT OR IGNORE on call creation.
 */
export async function assignStackGroup(
  db: D1Database,
  callId: number,
  address: string,
): Promise<void> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return;

  const sibling = await queryFirst<{ id: number; stack_group_id: string | null }>(
    db,
    `SELECT e.id, e.stack_group_id
     FROM calls_for_service c
     JOIN calls_for_service_ext e ON e.id = c.id
     WHERE LOWER(TRIM(c.location_address)) = ?
       AND ${ACTIVE_CALL_WHERE}
       AND c.id != ?
     LIMIT 1`,
    normalized,
    callId,
  );

  if (!sibling) return;

  const groupId = sibling.stack_group_id ?? uuidv4();

  if (!sibling.stack_group_id) {
    await execute(
      db,
      'UPDATE calls_for_service_ext SET stack_group_id = ? WHERE id = ?',
      groupId,
      sibling.id,
    );
  }

  await execute(
    db,
    'UPDATE calls_for_service_ext SET stack_group_id = ? WHERE id = ?',
    groupId,
    callId,
  );
}

/**
 * Removes a call from its stack group on closure/terminal status.
 * Dissolves singleton groups so no orphaned group IDs linger.
 */
export async function leaveStackGroup(db: D1Database, callId: number): Promise<void> {
  const ext = await queryFirst<{ stack_group_id: string | null }>(
    db,
    'SELECT stack_group_id FROM calls_for_service_ext WHERE id = ?',
    callId,
  );
  if (!ext?.stack_group_id) return;

  const groupId = ext.stack_group_id;

  await execute(
    db,
    'UPDATE calls_for_service_ext SET stack_group_id = NULL WHERE id = ?',
    callId,
  );

  const remaining = await queryFirst<{ cnt: number }>(
    db,
    'SELECT COUNT(*) as cnt FROM calls_for_service_ext WHERE stack_group_id = ?',
    groupId,
  );

  if (remaining && remaining.cnt <= 1) {
    await execute(
      db,
      'UPDATE calls_for_service_ext SET stack_group_id = NULL WHERE stack_group_id = ?',
      groupId,
    );
  }
}

/**
 * Called when a call's location_address changes.
 * Leaves the old group and joins/creates one at the new address.
 */
export async function reassignStackGroup(
  db: D1Database,
  callId: number,
  newAddress: string,
): Promise<void> {
  await leaveStackGroup(db, callId);
  await assignStackGroup(db, callId, newAddress);
}

/**
 * Fans out field writes to all active siblings in the same stack group.
 * Fill-only for dispatched_at / enroute_at / onscene_at / starting_mileage.
 * Overwrite for ending_mileage. Merge (dedup union) for unit arrays.
 * Errors are logged and swallowed — never blocks the primary request.
 */
export async function syncToStack(
  db: D1Database,
  stackGroupId: string,
  sourceCallId: number,
  fields: SyncFields,
): Promise<void> {
  try {
    const siblings = await query<{ id: number }>(
      db,
      `SELECT c.id
       FROM calls_for_service c
       JOIN calls_for_service_ext e ON e.id = c.id
       WHERE e.stack_group_id = ?
         AND c.id != ?
         AND ${ACTIVE_CALL_WHERE}`,
      stackGroupId,
      sourceCallId,
    );

    if (!siblings.length) return;

    for (const { id: sibId } of siblings) {
      // ── Timestamps (fill-only) ──
      if (fields.timestamps) {
        const parts: string[] = [];
        const vals: unknown[] = [];
        const { dispatched_at, enroute_at, onscene_at } = fields.timestamps;
        if (dispatched_at) {
          parts.push('dispatched_at = COALESCE(dispatched_at, ?)');
          vals.push(dispatched_at);
        }
        if (enroute_at) {
          parts.push('enroute_at = COALESCE(enroute_at, ?)');
          vals.push(enroute_at);
        }
        if (onscene_at) {
          parts.push('onscene_at = COALESCE(onscene_at, ?)');
          vals.push(onscene_at);
        }
        if (parts.length) {
          await execute(
            db,
            `UPDATE calls_for_service SET ${parts.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
            ...vals,
            sibId,
          );
        }
      }

      // ── Mileage ──
      if (fields.mileage) {
        const parts: string[] = [];
        const vals: unknown[] = [];
        const { starting_mileage, ending_mileage } = fields.mileage;
        if (starting_mileage !== undefined) {
          parts.push('starting_mileage = COALESCE(starting_mileage, ?)');
          vals.push(starting_mileage);
        }
        if (ending_mileage !== undefined) {
          parts.push('ending_mileage = ?');
          vals.push(ending_mileage);
        }
        if (parts.length) {
          await execute(
            db,
            `UPDATE calls_for_service SET ${parts.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
            ...vals,
            sibId,
          );
        }
      }

      // ── Units (merge) ──
      if (fields.units) {
        const sib = await queryFirst<{
          assigned_unit_ids: string | null;
          unit_call_signs: string | null;
        }>(
          db,
          'SELECT assigned_unit_ids, unit_call_signs FROM calls_for_service WHERE id = ?',
          sibId,
        );

        let ids: number[] = [];
        try { ids = JSON.parse(sib?.assigned_unit_ids || '[]'); } catch { ids = []; }
        let signs: string[] = [];
        try { signs = JSON.parse(sib?.unit_call_signs || '[]'); } catch { signs = []; }

        if (fields.units.addIds?.length) {
          ids = Array.from(new Set([...ids, ...fields.units.addIds]));
        }
        if (fields.units.addCallSigns?.length) {
          const toAdd = fields.units.addCallSigns.filter((s) => s && !signs.includes(s));
          signs = [...signs, ...toAdd];
        }
        if (fields.units.removeIds?.length) {
          const removeSet = new Set(fields.units.removeIds);
          ids = ids.filter((id) => !removeSet.has(id));
        }
        if (fields.units.removeCallSigns?.length) {
          const removeSet = new Set(fields.units.removeCallSigns);
          signs = signs.filter((s) => !removeSet.has(s));
        }

        await execute(
          db,
          `UPDATE calls_for_service SET assigned_unit_ids = ?, unit_call_signs = ?, updated_at = datetime('now') WHERE id = ?`,
          JSON.stringify(ids),
          JSON.stringify(signs),
          sibId,
        );
      }
    }
  } catch (err) {
    log.error('syncToStack failed — sync skipped', { stackGroupId, sourceCallId }, err);
  }
}
