// ============================================================
// Officer Certification Expiration Sweep
// ============================================================
// GET /training/certs?expiring=true and the /training/stats
// expiring_certs count are both on-demand-only — nothing proactively
// tells anyone a firearms qualification, first-aid card, or other
// required certification is about to lapse (or already has). Same
// dashboard-only-dashboard-nobody-checks pattern as fleet maintenance
// before that got a cron sweep this session; reuses the same
// notification-rule engine.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import { query } from './db';
import { evaluateNotificationRules } from '../routes/notificationEngine';

interface ExpiringCertRow {
  id: number;
  officer_id: number;
  officer_name: string | null;
  cert_name: string | null;
  expiration_date: string;
}

export async function sweepCertExpirations(
  db: D1Database,
  env?: { ALERT_HUB?: DurableObjectNamespace },
): Promise<{ expired: number; expiringSoon: number; notified: number }> {
  const rows = await query<ExpiringCertRow>(db, `
    SELECT oc.id, oc.officer_id, u.full_name AS officer_name, ct.cert_name, oc.expiration_date
    FROM officer_certifications oc
    LEFT JOIN certification_types ct ON oc.cert_type_id = ct.id
    LEFT JOIN users u ON oc.officer_id = u.id
    WHERE oc.status = 'active'
      AND oc.expiration_date IS NOT NULL
      AND oc.expiration_date <= date('now', '+30 days')
      -- Floor: a cert that expired long ago (and was never status-flipped)
      -- matched forever and re-notified daily, unbounded. One week of
      -- post-expiry reminders is the alerting window; older rows are records.
      AND oc.expiration_date >= date('now', '-7 days')
  `);

  const today = Date.now();
  let expiredCount = 0;
  let expiringSoonCount = 0;
  let notified = 0;

  for (const cert of rows) {
    const daysUntil = Math.round((Date.parse(cert.expiration_date) - today) / 86_400_000);
    const expired = daysUntil < 0;
    if (expired) expiredCount++; else expiringSoonCount++;

    const certLabel = cert.cert_name ?? 'Certification';
    const officerLabel = cert.officer_name ?? `officer #${cert.officer_id}`;
    const { notified: n } = await evaluateNotificationRules(db, 'certification_expiring', {
      title: expired ? `Expired: ${certLabel} — ${officerLabel}` : `Expiring soon: ${certLabel} — ${officerLabel}`,
      message: expired
        ? `${officerLabel}'s ${certLabel} expired ${Math.abs(daysUntil)} day(s) ago.`
        : `${officerLabel}'s ${certLabel} expires in ${daysUntil} day(s).`,
      priority: expired ? 'high' : 'normal',
      entity_type: 'officer_certification',
      entity_id: cert.id,
    }, env);
    notified += n;
  }

  return { expired: expiredCount, expiringSoon: expiringSoonCount, notified };
}
