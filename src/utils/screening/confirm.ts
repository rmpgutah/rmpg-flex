import type { Bindings } from '../../types';
import type { ScreeningHitRow } from './types';
import { getDb, queryFirst, execute } from '../db';
import { getAdapter } from './registry';

export async function confirmScreeningHit(
  env: Bindings,
  hitId: number,
  userId: number,
): Promise<ScreeningHitRow & { promotedRef: string }> {
  const db = getDb(env);
  const hit = await queryFirst<ScreeningHitRow>(db, 'SELECT * FROM screening_hits WHERE id = ?', hitId);
  if (!hit) throw new Error(`screening_hit ${hitId} not found`);
  const adapter = getAdapter(hit.source_key);
  let promotedRef = 'noted';
  if (adapter) {
    const r = await adapter.confirmHit(env, hit);
    promotedRef = r.promotedRef;
  }
  await execute(
    db,
    "UPDATE screening_hits SET status='confirmed', reviewed_by=?, reviewed_at=datetime('now'), promoted_ref=? WHERE id=?",
    userId,
    promotedRef,
    hitId,
  );
  return { ...hit, status: 'confirmed', promoted_ref: promotedRef, reviewed_by: userId, promotedRef };
}

export async function dismissScreeningHit(
  env: Bindings,
  hitId: number,
  userId: number,
): Promise<ScreeningHitRow> {
  const db = getDb(env);
  const hit = await queryFirst<ScreeningHitRow>(db, 'SELECT * FROM screening_hits WHERE id = ?', hitId);
  if (!hit) throw new Error(`screening_hit ${hitId} not found`);
  await execute(
    db,
    "UPDATE screening_hits SET status='dismissed', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?",
    userId,
    hitId,
  );
  return { ...hit, status: 'dismissed', reviewed_by: userId };
}
