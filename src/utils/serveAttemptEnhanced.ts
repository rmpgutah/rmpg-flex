// ============================================================
// RMPG Flex — Enhanced serve attempt utilities
// ============================================================
// NCIC/warrant checks at attempt time, GPS breadcrumbs, real-time
// status broadcasting, exponential backoff retries, stale escalation,
// attempt summaries, data validation, and analytics.
//
// Cloudflare Workers + D1 only — no Node.js APIs.
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';
import { query, queryFirst, execute, columnExists } from './db';
import { broadcastDispatchUpdate } from '../lib/broadcast';
import { emitAlert } from './alertHub';
import { log } from './logger';

// ── Type definitions ─────────────────────────────────────────

export interface NcicHit {
  type: 'warrant' | 'protection_order' | 'criminal_record' | 'missing_person';
  agency: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  details: string;
}

export interface AttemptData {
  queueId: number;
  serverId: number;
  attemptNumber: number;
  status: string;
  method: string;
  address: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  photoUrls?: string[];
  scheduledDate?: string;
  completedAt?: string;
}

// ── Utah GPS bounds ──────────────────────────────────────────

const UTAH_BOUNDS = {
  latMin: 36.998,
  latMax: 42.001,
  lngMin: -114.053,
  lngMax: -109.041,
};

// ── Valid statuses / methods ─────────────────────────────────

const VALID_STATUSES = new Set([
  'pending', 'scheduled', 'en_route', 'attempting',
  'served', 'sub_served', 'posted', 'no_answer', 'refused',
  'bad_address', 'moved', 'deceased', 'cancelled', 'other',
]);

const VALID_METHODS = new Set([
  'personal', 'substitute', 'posting', 'mail',
]);

// ── Retry backoff schedule ───────────────────────────────────

const BACKOFF_DAYS = [2, 5, 14, 30];

// ============================================================
// 1. checkNcicAtAttempt — Enhanced NCIC/warrant check
// ============================================================

export async function checkNcicAtAttempt(
  db: D1Database,
  defendantName: string,
  dob?: string,
): Promise<{ wants: boolean; hits: NcicHit[]; warnings: string[] }> {
  const hits: NcicHit[] = [];
  const warnings: string[] = [];
  const name = (defendantName || '').trim();

  if (!name) {
    warnings.push('No defendant name provided for NCIC check');
    return { wants: false, hits, warnings };
  }

  const parts = name.split(/\s+/);
  const lastName = parts[0]?.toLowerCase() ?? '';
  const firstName = parts.slice(1).join(' ').toLowerCase();

  // ── 1a. Search local warrants ──
  try {
    const warrantQuery = firstName
      ? `SELECT id, warrant_number, type, status, subject_name, offense,
                charge_description, issuing_agency, severity, description
           FROM warrants
          WHERE status = 'active'
            AND (
              LOWER(subject_last_name) = ?
              OR LOWER(subject_name) LIKE ?
            )
          ORDER BY
            CASE WHEN LOWER(subject_first_name) = ? THEN 0 ELSE 1 END,
            issued_date DESC
          LIMIT 20`
      : `SELECT id, warrant_number, type, status, subject_name, offense,
                charge_description, issuing_agency, severity, description
           FROM warrants
          WHERE status = 'active'
            AND (
              LOWER(subject_last_name) = ?
              OR LOWER(subject_name) LIKE ?
            )
          ORDER BY issued_date DESC
          LIMIT 20`;

    const warrantBindings = firstName
      ? [lastName, `%${name.toLowerCase()}%`, firstName]
      : [lastName, `%${name.toLowerCase()}%`];

    const warrants = await query<{
      id: number;
      warrant_number: string | null;
      type: string;
      status: string;
      subject_name: string | null;
      offense: string | null;
      charge_description: string | null;
      issuing_agency: string | null;
      severity: string | null;
      description: string | null;
    }>(db, warrantQuery, ...warrantBindings);

    for (const w of warrants) {
      hits.push({
        type: 'warrant',
        agency: w.issuing_agency || 'Unknown',
        description: w.charge_description || w.offense || w.warrant_number || `Warrant #${w.id}`,
        severity: mapWarrantSeverity(w.severity),
        details: [
          w.warrant_number ? `#${w.warrant_number}` : null,
          w.type ? `(${w.type})` : null,
          w.description || null,
        ].filter(Boolean).join(' '),
      });
    }
  } catch (err) {
    warnings.push(`Warrant check failed: ${(err as Error).message}`);
  }

  // ── 1b. Search persons table for flags / NCIC number ──
  try {
    const personQuery = firstName
      ? `SELECT id, first_name, last_name, ncic_number, sor_number,
                is_sex_offender, caution_flags, flags
           FROM persons
          WHERE LOWER(last_name) = ?
            AND (LOWER(first_name) = ? OR ? = '')
          LIMIT 10`
      : `SELECT id, first_name, last_name, ncic_number, sor_number,
                is_sex_offender, caution_flags, flags
           FROM persons
          WHERE LOWER(last_name) = ?
          LIMIT 10`;

    const personBindings = firstName
      ? [lastName, firstName, firstName]
      : [lastName];

    const persons = await query<{
      id: number;
      first_name: string;
      last_name: string;
      ncic_number: string | null;
      sor_number: string | null;
      is_sex_offender: number | null;
      caution_flags: string | null;
      flags: string | null;
    }>(db, personQuery, ...personBindings);

    for (const p of persons) {
      if (p.is_sex_offender) {
        hits.push({
          type: 'criminal_record',
          agency: 'NSOPW',
          description: `Sex offender: ${p.first_name} ${p.last_name}`,
          severity: 'high',
          details: `SOR #${p.sor_number || 'N/A'} — listed sex offender`,
        });
      }

      if (p.caution_flags) {
        try {
          const flags = JSON.parse(p.caution_flags);
          if (Array.isArray(flags)) {
            for (const f of flags) {
              hits.push({
                type: 'criminal_record',
                agency: 'Internal',
                description: `Caution flag: ${f}`,
                severity: 'medium',
                details: `Person #${p.id} — ${p.first_name} ${p.last_name}`,
              });
            }
          }
        } catch { /* malformed JSON — skip */ }
      }

      if (p.flags) {
        try {
          const flags = JSON.parse(p.flags);
          if (Array.isArray(flags)) {
            for (const f of flags) {
              const flagStr = String(f).toLowerCase();
              if (flagStr.includes('danger') || flagStr.includes('armed') || flagStr.includes('violent')) {
                hits.push({
                  type: 'criminal_record',
                  agency: 'Internal',
                  description: `Flag: ${f}`,
                  severity: 'critical',
                  details: `Person #${p.id} — ${p.first_name} ${p.last_name}`,
                });
              }
            }
          }
        } catch { /* malformed JSON — skip */ }
      }

      if (p.ncic_number) {
        hits.push({
          type: 'criminal_record',
          agency: 'NCIC',
          description: `NCIC record found for ${p.first_name} ${p.last_name}`,
          severity: 'medium',
          details: `NCIC #${p.ncic_number}`,
        });
      }
    }
  } catch (err) {
    warnings.push(`Person search failed: ${(err as Error).message}`);
  }

  // ── 1c. Search nsopw tables ──
  try {
    const nsopwExists = await queryFirst<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='nsopw_query_cache'`,
    );
    if (nsopwExists?.n) {
      const nsopw = await query<{
        first_name: string | null;
        last_name: string | null;
        jurisdiction: string | null;
        offense: string | null;
        risk_level: string | null;
      }>(
        db,
        `SELECT first_name, last_name, jurisdiction, offense, risk_level
           FROM nsopw_query_cache
          WHERE LOWER(last_name) = ?
            AND (? = '' OR LOWER(first_name) = ?)
          LIMIT 10`,
        lastName, firstName, firstName,
      );

      for (const n of nsopw) {
        hits.push({
          type: 'missing_person',
          agency: n.jurisdiction || 'NSOPW',
          description: `NSOPW entry: ${n.first_name || ''} ${n.last_name || ''}`.trim(),
          severity: mapNsopwSeverity(n.risk_level),
          details: [
            n.offense ? `Offense: ${n.offense}` : null,
            n.risk_level ? `Risk: ${n.risk_level}` : null,
          ].filter(Boolean).join(' · ') || 'National Sex Offender Registry hit',
        });
      }
    }
  } catch (err) {
    warnings.push(`NSOPW check failed: ${(err as Error).message}`);
  }

  const wants = hits.some((h) => h.severity === 'critical' || h.severity === 'high');

  return { wants, hits, warnings };
}

function mapWarrantSeverity(raw: string | null): NcicHit['severity'] {
  const s = (raw || '').toLowerCase();
  if (s === 'critical' || s === 'felony' || s === 'p1') return 'critical';
  if (s === 'high' || s === 'misdemeanor' || s === 'p2') return 'high';
  if (s === 'medium' || s === 'p3') return 'medium';
  return 'low';
}

function mapNsopwSeverity(raw: string | null): NcicHit['severity'] {
  const r = (raw || '').toLowerCase();
  if (r.includes('high') || r.includes('level 3') || r.includes('tier 3')) return 'critical';
  if (r.includes('medium') || r.includes('level 2') || r.includes('tier 2')) return 'high';
  if (r.includes('low') || r.includes('level 1') || r.includes('tier 1')) return 'medium';
  return 'medium';
}

// ============================================================
// 2. logAttemptGpsBreadcrumb — GPS position during attempt
// ============================================================

export async function logAttemptGpsBreadcrumb(
  db: D1Database,
  attemptId: number,
  lat: number,
  lng: number,
  accuracy: number,
): Promise<void> {
  // Create table if not exists (idempotent)
  try {
    await execute(
      db,
      `CREATE TABLE IF NOT EXISTS serve_attempt_gps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL REFERENCES serve_attempts(id) ON DELETE CASCADE,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        accuracy_meters REAL,
        logged_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    );
  } catch { /* race or pre-existing — tolerated */ }

  // Ensure index exists
  try {
    await execute(
      db,
      `CREATE INDEX IF NOT EXISTS idx_serve_attempt_gps_attempt
        ON serve_attempt_gps(attempt_id)`,
    );
  } catch { /* ignore */ }

  await execute(
    db,
    `INSERT INTO serve_attempt_gps (attempt_id, latitude, longitude, accuracy_meters)
     VALUES (?, ?, ?, ?)`,
    attemptId, lat, lng, accuracy,
  );
}

// ============================================================
// 3. broadcastAttemptStatus — Dispatch hub real-time broadcast
// ============================================================

export async function broadcastAttemptStatus(
  db: D1Database,
  env: any,
  attemptId: number,
  status: string,
  serverName: string,
): Promise<void> {
  // Fetch attempt + queue context for a meaningful broadcast payload
  const attempt = await queryFirst<{
    id: number;
    serve_queue_id: number;
    attempt_number: number;
    result: string | null;
    officer_id: number | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    db,
    `SELECT id, serve_queue_id, attempt_number, result, officer_id, latitude, longitude
       FROM serve_attempts WHERE id = ?`,
    attemptId,
  );

  const queue = attempt
    ? await queryFirst<{
        id: number;
        recipient_name: string | null;
        case_number: string | null;
        recipient_address: string | null;
        status: string;
      }>(
        db,
        `SELECT id, recipient_name, case_number, recipient_address, status
           FROM serve_queue WHERE id = ?`,
        attempt.serve_queue_id,
      )
    : null;

  const payload = {
    action: 'serve_attempt_status',
    attemptId,
    queueId: attempt?.serve_queue_id ?? null,
    attemptNumber: attempt?.attempt_number ?? null,
    status,
    serverName,
    recipientName: queue?.recipient_name ?? null,
    caseNumber: queue?.case_number ?? null,
    address: queue?.recipient_address ?? null,
    queueStatus: queue?.status ?? null,
    officerId: attempt?.officer_id ?? null,
    latitude: attempt?.latitude ?? null,
    longitude: attempt?.longitude ?? null,
    timestamp: new Date().toISOString(),
  };

  // Broadcast via dispatch hub
  try {
    broadcastDispatchUpdate(env as Bindings, payload);
  } catch (err) {
    log.error('[serveAttemptEnhanced] dispatch broadcast failed', { attemptId, status, err });
  }

  // Also emit via AlertHub for officer-safety related statuses
  if (status === 'wants_hit' || status === 'ncic_alert' || status === 'cancelled') {
    try {
      await emitAlert(env as Bindings, 'serve_attempt_status', {
        ...payload,
        message: `Attempt #${attempt?.attempt_number} on queue #${attempt?.serve_queue_id}: ${status} (${serverName})`,
      });
    } catch {
      // AlertHub is fire-and-forget
    }
  }
}

// ============================================================
// 4. retryWithBackoff — Exponential backoff scheduling
// ============================================================

export async function retryWithBackoff(
  db: D1Database,
  attemptId: number,
): Promise<{ nextDate: string; backoffDays: number } | null> {
  const attempt = await queryFirst<{
    id: number;
    serve_queue_id: number;
    attempt_number: number;
  }>(
    db,
    `SELECT id, serve_queue_id, attempt_number
       FROM serve_attempts WHERE id = ?`,
    attemptId,
  );

  if (!attempt) return null;

  // Get total attempt count for this queue
  const countRow = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM serve_attempts WHERE serve_queue_id = ?`,
    attempt.serve_queue_id,
  );
  const totalAttempts = countRow?.n ?? 0;

  // Index into backoff schedule (clamped to max)
  const backoffIndex = Math.min(totalAttempts, BACKOFF_DAYS.length) - 1;
  const backoffDays = BACKOFF_DAYS[Math.max(0, backoffIndex)];

  // Calculate next attempt date from now
  const now = new Date();
  const nextDate = new Date(now.getTime() + backoffDays * 24 * 60 * 60 * 1000);

  const nextDateStr = nextDate.toISOString().split('T')[0];

  // Update the queue's next_attempt_note if the column exists
  const hasNextCol = await columnExists(db, 'serve_queue', 'next_attempt_note');
  if (hasNextCol) {
    await execute(
      db,
      `UPDATE serve_queue
          SET next_attempt_note = ?,
              updated_at = datetime('now','localtime')
        WHERE id = ?`,
      `Retry scheduled ${backoffDays} days out (${nextDateStr})`,
      attempt.serve_queue_id,
    );
  }

  log.info('[retryWithBackoff] scheduled retry', {
    queueId: attempt.serve_queue_id,
    attemptId,
    attemptNumber: attempt.attempt_number,
    backoffDays,
    nextDate: nextDateStr,
  });

  return { nextDate: nextDateStr, backoffDays };
}

// ============================================================
// 5. autoEscalateStale — Find and escalate stale attempts
// ============================================================

interface StaleJob {
  id: number;
  officer_id: number | null;
  recipient_name: string | null;
  case_number: string | null;
  priority: string;
  status: string;
  attempt_count: number;
  updated_at: string | null;
  attempts_since_stale: number;
}

export async function autoEscalateStale(
  db: D1Database,
  staleDays: number = 14,
): Promise<{ escalated: number; details: StaleJob[] }> {
  const thresholdIso = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();

  // Find jobs stuck with no progress
  const staleJobs = await query<StaleJob>(
    db,
    `SELECT q.id, q.officer_id, q.recipient_name, q.case_number,
            q.priority, q.status, q.attempt_count, q.updated_at,
            (SELECT COUNT(*) FROM serve_attempts a
              WHERE a.serve_queue_id = q.id
                AND a.attempt_at > q.updated_at) AS attempts_since_stale
       FROM serve_queue q
      WHERE q.status NOT IN ('served', 'cancelled', 'failed')
        AND q.updated_at <= ?
        AND q.attempt_count > 0
      ORDER BY q.updated_at ASC
      LIMIT 100`,
    thresholdIso,
  );

  if (!staleJobs.length) return { escalated: 0, details: [] };

  // Get supervisor IDs for notifications
  const supervisors = await query<{ id: number }>(
    db,
    "SELECT id FROM users WHERE role IN ('admin','manager','supervisor') LIMIT 50",
  );

  // Get server workload counts for reassignment candidates
  const serverWorkloads = await query<{ officer_id: number; active_count: number }>(
    db,
    `SELECT officer_id, COUNT(*) AS active_count
       FROM serve_queue
      WHERE officer_id IS NOT NULL
        AND status IN ('pending','assigned','in_progress','attempted')
      GROUP BY officer_id`,
  );

  const workloadMap = new Map(serverWorkloads.map((r) => [r.officer_id, r.active_count]));
  const escalated: StaleJob[] = [];

  for (const job of staleJobs) {
    try {
      const needsPriorityBump = job.priority === 'routine' || job.priority === 'normal';
      const newPriority = needsPriorityBump ? 'rush' : job.priority;

      // Escalate: bump priority + add urgency tier
      const priorityClause = needsPriorityBump ? `, priority = '${newPriority}'` : '';
      await execute(
        db,
        `UPDATE serve_queue
            SET urgency_tier = 'critical',
                urgency_computed_at = datetime('now','localtime')
                ${priorityClause}
          WHERE id = ?`,
        job.id,
      );

      // Check if reassignment is warranted (current officer overloaded)
      let reassignedTo: number | null = null;
      if (job.officer_id) {
        const currentLoad = workloadMap.get(job.officer_id) ?? 0;
        if (currentLoad > 10) {
          // Find least-loaded officer
          const leastLoaded = await queryFirst<{ id: number }>(
            db,
            `SELECT id FROM users
              WHERE role IN ('officer')
                AND id != ?
                AND id NOT IN (
                  SELECT officer_id FROM serve_queue
                  WHERE officer_id IS NOT NULL
                    AND status IN ('pending','assigned','in_progress','attempted')
                  GROUP BY officer_id
                  HAVING COUNT(*) >= 10
                )
              ORDER BY (SELECT COUNT(*) FROM serve_queue sq
                         WHERE sq.officer_id = users.id
                           AND sq.status IN ('pending','assigned','in_progress','attempted')) ASC
              LIMIT 1`,
            job.officer_id,
          );

          if (leastLoaded) {
            reassignedTo = leastLoaded.id;
            await execute(
              db,
              `UPDATE serve_queue SET officer_id = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
              reassignedTo,
              job.id,
            );
            // Update workload map
            workloadMap.set(reassignedTo, (workloadMap.get(reassignedTo) ?? 0) + 1);
            if (job.officer_id) {
              workloadMap.set(job.officer_id, Math.max(0, (workloadMap.get(job.officer_id) ?? 1) - 1));
            }
          }
        }
      }

      // Notify assigned officer + supervisors
      const recipients = new Set<number>();
      if (job.officer_id) recipients.add(job.officer_id);
      if (reassignedTo) recipients.add(reassignedTo);
      for (const s of supervisors) recipients.add(s.id);

      const who = job.recipient_name || `Job #${job.id}`;
      const caseRef = job.case_number ? ` — Case ${job.case_number}` : '';
      const reassignNote = reassignedTo ? ` Reassigned to officer #${reassignedTo}.` : '';

      for (const uid of recipients) {
        await execute(
          db,
          `INSERT INTO notifications (type, priority, title, message, entity_type, entity_id, user_id, is_read, created_at)
           VALUES ('serve_stale_escalation', 'high', 'Stale serve job escalated',
                   ?, 'serve_job', ?, ?, 0, datetime('now','localtime'))`,
          `Job stale >${staleDays}d: ${who}${caseRef}${reassignNote}`,
          job.id, uid,
        );
      }

      escalated.push({ ...job, priority: newPriority });
    } catch (err) {
      log.error('[autoEscalateStale] failed for job', { jobId: job.id }, err);
    }
  }

  return { escalated: escalated.length, details: escalated };
}

// ============================================================
// 6. generateAttemptSummary — Structured attempt summary
// ============================================================

interface AttemptSummary {
  queueId: number;
  totalAttempts: number;
  successCount: number;
  successRate: number;
  avgDaysBetweenAttempts: number;
  commonFailureReasons: { reason: string; count: number }[];
  serverDistribution: { serverId: number; serverName: string | null; count: number }[];
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  currentStatus: string | null;
}

export async function generateAttemptSummary(
  db: D1Database,
  queueId: number,
): Promise<AttemptSummary> {
  // Base queue info
  const queue = await queryFirst<{
    status: string | null;
    attempt_count: number;
  }>(
    db,
    `SELECT status, attempt_count FROM serve_queue WHERE id = ?`,
    queueId,
  );

  // All attempts for this queue
  const attempts = await query<{
    id: number;
    attempt_number: number;
    attempt_at: string;
    result: string | null;
    officer_id: number | null;
    latitude: number | null;
    longitude: number | null;
  }>(
    db,
    `SELECT id, attempt_number, attempt_at, result, officer_id, latitude, longitude
       FROM serve_attempts
      WHERE serve_queue_id = ?
      ORDER BY attempt_number ASC, id ASC`,
    queueId,
  );

  // Success rate
  const successResults = new Set(['served', 'sub_served', 'posted']);
  const successCount = attempts.filter((a) => successResults.has(a.result || '')).length;
  const totalAttempts = attempts.length;
  const successRate = totalAttempts > 0 ? successCount / totalAttempts : 0;

  // Avg days between attempts
  let avgDaysBetweenAttempts = 0;
  if (attempts.length >= 2) {
    let totalDays = 0;
    for (let i = 1; i < attempts.length; i++) {
      const prev = new Date(attempts[i - 1].attempt_at).getTime();
      const curr = new Date(attempts[i].attempt_at).getTime();
      totalDays += (curr - prev) / (24 * 60 * 60 * 1000);
    }
    avgDaysBetweenAttempts = totalDays / (attempts.length - 1);
  }

  // Common failure reasons
  const failureCounts = new Map<string, number>();
  for (const a of attempts) {
    if (a.result && !successResults.has(a.result)) {
      failureCounts.set(a.result, (failureCounts.get(a.result) || 0) + 1);
    }
  }
  const commonFailureReasons = Array.from(failureCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Server distribution
  const serverCounts = new Map<number, number>();
  for (const a of attempts) {
    if (a.officer_id != null) {
      serverCounts.set(a.officer_id, (serverCounts.get(a.officer_id) || 0) + 1);
    }
  }

  const serverDistribution: AttemptSummary['serverDistribution'] = [];
  for (const [serverId, count] of serverCounts) {
    const user = await queryFirst<{ username: string | null; first_name: string | null }>(
      db,
      `SELECT username, first_name FROM users WHERE id = ?`,
      serverId,
    );
    serverDistribution.push({
      serverId,
      serverName: user?.first_name || user?.username || `#${serverId}`,
      count,
    });
  }
  serverDistribution.sort((a, b) => b.count - a.count);

  return {
    queueId,
    totalAttempts,
    successCount,
    successRate,
    avgDaysBetweenAttempts,
    commonFailureReasons,
    serverDistribution,
    firstAttemptAt: attempts[0]?.attempt_at ?? null,
    lastAttemptAt: attempts[attempts.length - 1]?.attempt_at ?? null,
    currentStatus: queue?.status ?? null,
  };
}

// ============================================================
// 7. validateAttemptData — Validate attempt input
// ============================================================

export function validateAttemptData(
  data: Partial<AttemptData>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (data.queueId == null || typeof data.queueId !== 'number' || data.queueId <= 0) {
    errors.push('queueId is required and must be a positive integer');
  }
  if (data.serverId == null || typeof data.serverId !== 'number' || data.serverId <= 0) {
    errors.push('serverId is required and must be a positive integer');
  }
  if (data.attemptNumber == null || typeof data.attemptNumber !== 'number' || data.attemptNumber < 1) {
    errors.push('attemptNumber is required and must be >= 1');
  }

  // Status validation
  if (!data.status) {
    errors.push('status is required');
  } else if (!VALID_STATUSES.has(data.status)) {
    errors.push(`Invalid status: '${data.status}'. Must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }

  // Method validation
  if (!data.method) {
    errors.push('method is required');
  } else if (!VALID_METHODS.has(data.method)) {
    errors.push(`Invalid method: '${data.method}'. Must be one of: ${[...VALID_METHODS].join(', ')}`);
  }

  // Address
  if (!data.address || typeof data.address !== 'string' || data.address.trim().length === 0) {
    errors.push('address is required');
  }

  // GPS bounds — Utah only
  if (data.latitude != null) {
    if (typeof data.latitude !== 'number' || data.latitude < UTAH_BOUNDS.latMin || data.latitude > UTAH_BOUNDS.latMax) {
      errors.push(`latitude ${data.latitude} is outside Utah bounds (${UTAH_BOUNDS.latMin}–${UTAH_BOUNDS.latMax})`);
    }
  }
  if (data.longitude != null) {
    if (typeof data.longitude !== 'number' || data.longitude < UTAH_BOUNDS.lngMin || data.longitude > UTAH_BOUNDS.lngMax) {
      errors.push(`longitude ${data.longitude} is outside Utah bounds (${UTAH_BOUNDS.lngMin}–${UTAH_BOUNDS.lngMax})`);
    }
  }
  // If one GPS coord is present, both should be
  if ((data.latitude != null) !== (data.longitude != null)) {
    errors.push('Both latitude and longitude must be provided together');
  }

  // Time constraints
  if (data.scheduledDate) {
    const sched = new Date(data.scheduledDate);
    if (isNaN(sched.getTime())) {
      errors.push('scheduledDate is not a valid date');
    } else if (sched.getTime() < Date.now() - 7 * 24 * 60 * 60 * 1000) {
      errors.push('scheduledDate cannot be more than 7 days in the past');
    }
  }

  if (data.completedAt) {
    const comp = new Date(data.completedAt);
    if (isNaN(comp.getTime())) {
      errors.push('completedAt is not a valid date');
    } else if (comp.getTime() > Date.now() + 60 * 1000) {
      errors.push('completedAt cannot be in the future');
    }
  }

  // Photo URLs
  if (data.photoUrls != null) {
    if (!Array.isArray(data.photoUrls)) {
      errors.push('photoUrls must be an array');
    } else {
      for (const url of data.photoUrls) {
        if (typeof url !== 'string' || url.trim().length === 0) {
          errors.push('Each photoUrl must be a non-empty string');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================
// 8. getAttemptAnalytics — Comprehensive analytics
// ============================================================

interface AttemptAnalytics {
  dateRange: [string, string];
  totalAttempts: number;
  attemptsPerDay: { date: string; count: number }[];
  successRateTrend: { date: string; rate: number }[];
  topFailureReasons: { reason: string; count: number; percentage: number }[];
  serverEfficiency: {
    serverId: number;
    serverName: string | null;
    totalAttempts: number;
    successCount: number;
    successRate: number;
    avgAttemptsPerDay: number;
  }[];
  geoHeatMap: { lat: number; lng: number; count: number; clusterId: number }[];
}

export async function getAttemptAnalytics(
  db: D1Database,
  dateRange: [string, string],
): Promise<AttemptAnalytics> {
  const [start, end] = dateRange;

  // Total attempts in range
  const totalRow = await queryFirst<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM serve_attempts
      WHERE attempt_at >= ? AND attempt_at <= ?`,
    start, end,
  );

  // Attempts per day
  const perDay = await query<{ date: string; count: number }>(
    db,
    `SELECT DATE(attempt_at) AS date, COUNT(*) AS count
       FROM serve_attempts
      WHERE attempt_at >= ? AND attempt_at <= ?
      GROUP BY DATE(attempt_at)
      ORDER BY date ASC`,
    start, end,
  );

  // Success rate trend (per day)
  const successRateTrend = await query<{ date: string; total: number; served: number }>(
    db,
    `SELECT DATE(attempt_at) AS date,
            COUNT(*) AS total,
            SUM(CASE WHEN result IN ('served','sub_served','posted') THEN 1 ELSE 0 END) AS served
       FROM serve_attempts
      WHERE attempt_at >= ? AND attempt_at <= ?
      GROUP BY DATE(attempt_at)
      ORDER BY date ASC`,
    start, end,
  );

  const successRateTrendMapped = successRateTrend.map((r) => ({
    date: r.date,
    rate: r.total > 0 ? r.served / r.total : 0,
  }));

  // Top failure reasons
  const failRows = await query<{ result: string; count: number }>(
    db,
    `SELECT result, COUNT(*) AS count
       FROM serve_attempts
      WHERE attempt_at >= ? AND attempt_at <= ?
        AND result NOT IN ('served','sub_served','posted')
        AND result IS NOT NULL
      GROUP BY result
      ORDER BY count DESC
      LIMIT 10`,
    start, end,
  );
  const totalFailures = failRows.reduce((s, r) => s + r.count, 0);
  const topFailureReasons = failRows.map((r) => ({
    reason: r.result,
    count: r.count,
    percentage: totalFailures > 0 ? r.count / totalFailures : 0,
  }));

  // Server efficiency
  const serverRows = await query<{
    officer_id: number;
    total_attempts: number;
    success_count: number;
  }>(
    db,
    `SELECT officer_id,
            COUNT(*) AS total_attempts,
            SUM(CASE WHEN result IN ('served','sub_served','posted') THEN 1 ELSE 0 END) AS success_count
       FROM serve_attempts
      WHERE attempt_at >= ? AND attempt_at <= ?
        AND officer_id IS NOT NULL
      GROUP BY officer_id
      ORDER BY total_attempts DESC`,
    start, end,
  );

  const serverEfficiency: AttemptAnalytics['serverEfficiency'] = [];
  const rangeDays = Math.max(1, (new Date(end).getTime() - new Date(start).getTime()) / (24 * 60 * 60 * 1000));
  for (const r of serverRows) {
    const user = await queryFirst<{ username: string | null; first_name: string | null }>(
      db,
      `SELECT username, first_name FROM users WHERE id = ?`,
      r.officer_id,
    );
    serverEfficiency.push({
      serverId: r.officer_id,
      serverName: user?.first_name || user?.username || `#${r.officer_id}`,
      totalAttempts: r.total_attempts,
      successCount: r.success_count,
      successRate: r.total_attempts > 0 ? r.success_count / r.total_attempts : 0,
      avgAttemptsPerDay: r.total_attempts / rangeDays,
    });
  }

  // Geo heat map — cluster nearby GPS points
  const gpsPoints = await query<{ latitude: number; longitude: number }>(
    db,
    `SELECT latitude, longitude
       FROM serve_attempts
      WHERE attempt_at >= ? AND attempt_at <= ?
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      LIMIT 5000`,
    start, end,
  );

  const geoHeatMap = clusterGeoPoints(gpsPoints);

  return {
    dateRange: dateRange,
    totalAttempts: totalRow?.n ?? 0,
    attemptsPerDay: perDay,
    successRateTrend: successRateTrendMapped,
    topFailureReasons,
    serverEfficiency,
    geoHeatMap,
  };
}

// ── Geo clustering (simple grid-based) ──────────────────────

function clusterGeoPoints(
  points: { latitude: number; longitude: number }[],
): { lat: number; lng: number; count: number; clusterId: number }[] {
  // Grid cell size: ~0.01 degrees ≈ 0.7 miles
  const GRID_SIZE = 0.01;
  const grid = new Map<string, { lat: number; lng: number; count: number }>();

  for (const p of points) {
    const gridLat = Math.round(p.latitude / GRID_SIZE) * GRID_SIZE;
    const gridLng = Math.round(p.longitude / GRID_SIZE) * GRID_SIZE;
    const key = `${gridLat.toFixed(4)},${gridLng.toFixed(4)}`;

    const existing = grid.get(key);
    if (existing) {
      existing.count++;
    } else {
      grid.set(key, { lat: gridLat, lng: gridLng, count: 1 });
    }
  }

  return Array.from(grid.values())
    .sort((a, b) => b.count - a.count)
    .map((g, i) => ({ ...g, clusterId: i }));
}
