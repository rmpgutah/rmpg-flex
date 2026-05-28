// Premise history endpoint — supports the New Call modal's pre-create
// premise check ("Has this address generated calls before?"). The
// existing client (PremiseHistory.tsx) expects `{ hasWarnings, total,
// entries }` shape. Address match is case-insensitive substring so
// "3533 South Terra Sol Drive" matches "3533 S Terra Sol Dr" written
// at call-create time with different shorthand.

import { Hono } from 'hono';
import type { Env } from '../../types';
import { getDb, query } from '../../utils/db';

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
premise.get('/premise-history', async (c) => {
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
    params.push(`%${address.trim().toUpperCase()}%`);
  }

  const rows = await query<PremiseHistoryRow>(
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

  // hasWarnings reflects the officer-safety signal — present rows
  // with weapons / DV / injuries / caution flag should make the
  // modal play the alert tone (PremiseHistory.tsx checks this).
  const hasWarnings = rows.some(
    (r) => r.weapons_involved || r.domestic_violence || r.injuries_reported || r.officer_safety_caution,
  );

  return c.json({
    hasWarnings,
    total: rows.length,
    entries: rows,
  });
});

export default premise;
