// ============================================================
// Offender registry — stats only (no list/search yet)
// ============================================================
// Live table: offender_alerts (id, person_id, alert_type, status,
// severity, alert_address, alert_latitude, alert_longitude, description,
// last_compliance_check, last_compliance_result, created_at, updated_at).
//
// OffenderRegistryPage reads `{data}` from /offender-registry/stats and
// passes it straight into the tile array. Counts by alert_type / status /
// severity give the page enough to render its top-row tiles. Per-person
// list + sex-offender-specific cross-referencing is a follow-up.

import { Hono } from 'hono';
import type { Env } from '../types';
import { getDb, query, queryFirst } from '../utils/db';

const offenderRegistry = new Hono<Env>();

offenderRegistry.get('/stats', async (c) => {
  try {
    const db = getDb(c.env);

    const totals = await queryFirst<Record<string, number>>(db, `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) AS high_severity,
        SUM(CASE WHEN last_compliance_result = 'non_compliant' THEN 1 ELSE 0 END) AS non_compliant
      FROM offender_alerts
    `);

    const byType = await query<{ alert_type: string; count: number }>(db, `
      SELECT COALESCE(alert_type, 'unknown') AS alert_type, COUNT(*) AS count
      FROM offender_alerts GROUP BY alert_type ORDER BY count DESC
    `);

    const bySeverity = await query<{ severity: string; count: number }>(db, `
      SELECT COALESCE(severity, 'unknown') AS severity, COUNT(*) AS count
      FROM offender_alerts GROUP BY severity ORDER BY count DESC
    `);

    return c.json({
      data: {
        total: totals?.total ?? 0,
        active: totals?.active ?? 0,
        expired: totals?.expired ?? 0,
        high_severity: totals?.high_severity ?? 0,
        non_compliant: totals?.non_compliant ?? 0,
        by_type: byType,
        by_severity: bySeverity,
      },
    });
  } catch (err) {
    console.error('GET /offender-registry/stats error:', err);
    return c.json({ data: {} }, 200);
  }
});

export default offenderRegistry;
