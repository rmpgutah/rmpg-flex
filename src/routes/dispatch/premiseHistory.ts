// Premise history endpoint — supports the New Call modal's pre-create
// premise check ("Has this address generated calls before?"). The
// existing client (PremiseHistory.tsx) expects `{ hasWarnings, total,
// entries }` shape. Address match is case-insensitive substring so
// "3533 South Terra Sol Drive" matches "3533 S Terra Sol Dr" written
// at call-create time with different shorthand.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';
import { log } from '../../utils/logger';
import { requireRole } from '../../middleware/auth';

const premise = new Hono<Env>();

interface PremiseHistoryRow {
  id: number;
  call_number: string;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string;
  created_at: string;
  cleared_at: string | null;
  disposition: string | null;
  weapons_involved: string | null;
  domestic_violence: number | null;
  injuries_reported: number | null;
  officer_safety_caution: number | null;
}

// GET /dispatch/premise-history?address=...&property_id=...
premise.get('/premise-history', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const address = c.req.query('address') || '';
  const propertyId = c.req.query('property_id');

  // Need either address or property_id; less than 3 chars is noise.
  if (!propertyId && address.trim().length < 3) {
    return c.json({ hasWarnings: false, total: 0, entries: [] });
  }

  // Last 2 years is the operational window — old calls aren't a
  // useful "premise alert" signal for an officer enroute.
  let whereClause = "WHERE created_at >= datetime('now', '-2 years')";
  const params: unknown[] = [];
  if (propertyId) {
    whereClause += ' AND property_id = ?';
    params.push(propertyId);
  } else {
    // Normalize address for fuzzy match. SQLite LIKE is case-insensitive
    // for ASCII by default; we strip the first 6 chars (typically a
    // street number) to widen the match. Won't match across totally
    // different streets because of the LIKE bounds.
    whereClause += ' AND UPPER(location_address) LIKE ?';
    params.push(`%${address.trim().toUpperCase().slice(0, 48)}%`);
  }

  let rows: PremiseHistoryRow[];
  try {
    rows = await query<PremiseHistoryRow>(
      db,
      `SELECT id, call_number, incident_type, priority, status,
              location_address, created_at, cleared_at, disposition,
              weapons_involved, domestic_violence, injuries_reported,
              officer_safety_caution
       FROM calls_for_service
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 50`,
      ...params,
    );
  } catch (err) {
    log.error('GET /premise-history query failed', { address, propertyId }, err as Error);
    return c.json({ hasWarnings: false, total: 0, entries: [] });
  }

  // hasWarnings reflects the officer-safety signal — present rows with weapons /
  // DV / injuries / caution flag should make the modal play the alert tone
  // (PremiseHistory.tsx checks this). NOTE weapons_involved is a TEXT column that
  // stores literal sentinel strings ("None"/"N/A"/"0"/"") not NULL, so a naive
  // truthiness check fires a FALSE alert tone on a no-weapon premise. Guard it;
  // the others (domestic_violence/injuries_reported/officer_safety_caution) are
  // integer flags and are safe as-is.
  const WEAP_SENTINEL = new Set(['', 'none', 'n/a', 'na', '0', 'null', 'unknown', 'unk']);
  const hasWarnings = rows.some((r) => {
    const weap = (r.weapons_involved ?? '').toString().trim().toLowerCase();
    const weaponReal = weap.length > 0 && !WEAP_SENTINEL.has(weap);
    return weaponReal || r.domestic_violence || r.injuries_reported || r.officer_safety_caution;
  });

  return c.json({
    hasWarnings,
    total: rows.length,
    entries: rows,
  });
});

// GET /dispatch/address-occupants?address=...
// Officer-safety cross-reference for the New Call modal: who is on file at
// this address, and is anyone flagged (active warrant / gang / caution). Prior
// CALLS (premise-history) tell you what happened here; this tells you WHO is
// here. Additive + separate from premise-history so it can't regress that
// (still-legacy) endpoint. Best-effort throughout — a miss returns an empty
// list, never an error that would block call creation.
premise.get('/address-occupants', requireRole('officer', 'dispatcher', 'supervisor', 'manager', 'admin'), async (c) => {
  const db = getDb(c.env);
  const address = (c.req.query('address') || '').trim();
  if (address.length < 5) return c.json({ occupants: [], occupant_count: 0, has_flagged: false });

  const SENTINEL = new Set(['', 'none', 'n/a', 'na', '0', 'null', 'unknown']);
  try {
    const people = await query<Record<string, unknown>>(
      db,
      `SELECT p.id, p.first_name, p.last_name, p.dob, p.address, p.flags, p.gang_affiliation,
              (SELECT COUNT(*) FROM warrants w
                 WHERE w.subject_person_id = p.id
                   AND LOWER(COALESCE(w.status, '')) IN ('active', 'outstanding', 'confirmed')) AS active_warrants
       FROM persons p
       WHERE UPPER(p.address) LIKE ?
       ORDER BY active_warrants DESC, p.last_name
       LIMIT 25`,
      `%${address.toUpperCase().slice(0, 48)}%`,
    );
    const occupants = people.map((p) => {
      let flags: string[] = [];
      try {
        const parsed = JSON.parse((p.flags as string) || '[]');
        if (Array.isArray(parsed)) flags = parsed.map((x) => (typeof x === 'string' ? x : (x as { type?: string })?.type)).filter((x): x is string => !!x);
      } catch { /* flags free-form/absent */ }
      const gangRaw = ((p.gang_affiliation as string) ?? '').toString().trim();
      const gang = SENTINEL.has(gangRaw.toLowerCase()) ? null : gangRaw;
      const warrants = Number(p.active_warrants) || 0;
      const flaggedCaution = flags.some((t) => /caution|armed|violent|danger|weapon|gang/i.test(t));
      return {
        id: p.id,
        name: `${(p.first_name as string) || ''} ${(p.last_name as string) || ''}`.trim() || `Person #${p.id}`,
        dob: (p.dob as string) || null,
        flags,
        gang,
        active_warrants: warrants,
        caution: warrants > 0 || !!gang || flaggedCaution,
      };
    });
    return c.json({
      occupants,
      occupant_count: occupants.length,
      has_flagged: occupants.some((o) => o.caution),
    });
  } catch (err) {
    log.error('[dispatch] address-occupants lookup failed', {}, err);
    return c.json({ occupants: [], occupant_count: 0, has_flagged: false });
  }
});

export default premise;
